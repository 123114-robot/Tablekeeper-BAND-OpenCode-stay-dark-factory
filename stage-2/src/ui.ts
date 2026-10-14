/**
 * The Stage 2 browser surface: four server-rendered screens over the same origin as
 * the API, plus one vanilla script that drives them.
 *
 * No CDN, no framework, no build step: the markup and the stylesheet are inline, so
 * the container is self-contained and the origin needs no outbound network. The
 * script talks to the same-origin API and keeps the bearer token in `localStorage`.
 *
 * The behavioural rules from spec §Competing clients are implemented client-side:
 *   - searches are tagged with a monotonic id, so a late response never overwrites a
 *     newer grid;
 *   - a 409 `table_unavailable` shows `booking-error`, refreshes availability and
 *     keeps the open form and its inputs;
 *   - a lost response shows nonempty `booking-uncertain` and keeps the same
 *     idempotency key and body, so an unchanged retry recovers the original
 *     confirmation rather than booking twice.
 */

import type { State } from './store.ts';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function restaurantOptions(state: State): string {
  return state.restaurantOrder
    .map((id) => {
      const restaurant = state.restaurants.get(id);
      if (restaurant === undefined) return '';
      return `<option value="${escapeHtml(restaurant.id)}">${escapeHtml(restaurant.name)}</option>`;
    })
    .join('');
}

const STYLE = `
:root{--bg:#fbf7f2;--ink:#241d17;--muted:#6b5f55;--brand:#9b3b1f;--brand-ink:#fff;--line:#e2d7ca;--ok:#1f6b45;--bad:#a1231a;}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 1rem;padding:.75rem 1rem;border-bottom:1px solid var(--line);background:#fff}
.brand{font-weight:700;color:var(--brand);text-decoration:none;font-size:1.05rem}
nav{display:flex;flex-wrap:wrap;gap:.75rem}
nav a{color:var(--muted);text-decoration:none}
nav a:hover{color:var(--brand)}
#session{margin-left:auto;display:flex;align-items:center;gap:.5rem}
main{max-width:60rem;margin:0 auto;padding:1rem;display:flex;flex-direction:column;gap:1rem}
h1{font-size:1.4rem;margin:.2rem 0 .6rem}
.panel{background:#fff;border:1px solid var(--line);border-radius:.6rem;padding:1rem}
.row{display:flex;flex-wrap:wrap;gap:.75rem;align-items:flex-end}
.field{display:flex;flex-direction:column;gap:.25rem;font-size:.85rem;color:var(--muted);min-width:10rem}
select,input,button{font:inherit}
select,input{padding:.5rem .6rem;border:1px solid var(--line);border-radius:.4rem;background:#fff;color:var(--ink)}
button{cursor:pointer;border:1px solid var(--line);border-radius:.4rem;background:#fff;padding:.5rem .8rem}
button.primary{background:var(--brand);color:var(--brand-ink);border-color:var(--brand);font-weight:600}
button:focus-visible,select:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid #d98b3a;outline-offset:2px}
button[disabled]{opacity:.5;cursor:not-allowed}
.grid{display:flex;gap:.5rem;overflow-x:auto;padding-bottom:.5rem}
.col{display:flex;flex-direction:column;gap:.4rem;min-width:6.5rem}
.colhead{font-weight:600;text-align:center}
.cell{padding:.5rem;border:1px solid var(--line);border-radius:.4rem;background:#fff}
.cell[data-available="true"]{border-color:var(--ok);background:#eef7f1}
.cell[data-available="false"]{color:var(--muted);background:#f2ede8;border-style:dashed}
.cell.combo[data-available="true"]{background:#eef2fb;border-color:#33518f}
.error{color:#fff;background:var(--bad);padding:.5rem .7rem;border-radius:.4rem}
.success{border-color:var(--ok)}
.uncertain{color:#4a3600;background:#fdf3cf;padding:.5rem .7rem;border-radius:.4rem}
.empty{color:var(--muted);padding:1rem;text-align:center;border:1px dashed var(--line);border-radius:.6rem}
@media(max-width:420px){main{padding:.6rem}.field{min-width:100%}}
`;

/**
 * The single client script. It is route-aware via `document.body.dataset.route` and
 * uses no template literals of its own, so this file's outer template stays simple.
 */
const SCRIPT = String.raw`
(function(){
  'use strict';
  function $(n){ return document.querySelector('[data-testid=\'' + n + '\']'); }
  function tok(){ return localStorage.getItem('tk_token'); }
  function uname(){ return localStorage.getItem('tk_name') || ''; }
  function setSession(t,n){ localStorage.setItem('tk_token',t); localStorage.setItem('tk_name',n); }
  function clearSession(){ localStorage.removeItem('tk_token'); localStorage.removeItem('tk_name'); }
  function newKey(){ try { return crypto.randomUUID(); } catch(e){ return 'k-' + Date.now() + '-' + Math.random().toString(16).slice(2); } }
  function enc(v){ return encodeURIComponent(v); }

  function renderSession(){
    var box=document.getElementById('session'); if(!box) return; box.innerHTML='';
    if(tok()){
      var s=document.createElement('span'); s.setAttribute('data-testid','current-user'); s.textContent=uname();
      var b=document.createElement('button'); b.type='button'; b.setAttribute('data-testid','logout-button'); b.textContent='Log out';
      b.addEventListener('click', function(){ clearSession(); location.href='/'; });
      box.appendChild(s); box.appendChild(b);
    }
  }

  function authHost(){ return document.getElementById('auth'); }
  function removeAuthError(){ var e=$('auth-error'); if(e) e.remove(); }
  function makeAuthError(msg){ removeAuthError(); var h=authHost(); if(!h) return; var d=document.createElement('div'); d.setAttribute('data-testid','auth-error'); d.setAttribute('role','alert'); d.className='error'; d.textContent=msg; h.appendChild(d); }

  function readJson(r){ return r.text().then(function(t){ var b=null; if(t){ try{ b=JSON.parse(t); }catch(e){ b=null; } } return { ok:r.ok, status:r.status, body:b }; }); }
  function getJson(url, withAuth){ var h={}; if(withAuth && tok()) h['authorization']='Bearer '+tok(); return fetch(url,{headers:h}).then(readJson); }
  function sendJson(method, url, body, withAuth, key){ var h={}; if(withAuth && tok()) h['authorization']='Bearer '+tok(); if(key) h['idempotency-key']=key; var init={method:method,headers:h}; if(body!==null && body!==undefined){ h['content-type']='application/json'; init.body=JSON.stringify(body); } return fetch(url,init).then(readJson); }
  function errMsg(res){ if(res && res.body && res.body.error && res.body.error.message) return res.body.error.message; return 'That did not work. Please check your details.'; }

  // ---- search -------------------------------------------------------------
  var searchSeq=0, currentSearch=null, booking=null;

  function hhmmOf(stamp){ return stamp.slice(11,16); }
  function findTable(tables,id){ for(var i=0;i<tables.length;i++){ if(tables[i].id===id) return tables[i]; } return null; }

  function doSearch(){
    var rid=$('restaurant-select').value, date=$('date-input').value, party=parseInt($('party-size-input').value,10);
    if(!(party>0)) party=1;
    var seq=++searchSeq;
    Promise.all([
      getJson('/availability?restaurant_id='+enc(rid)+'&date='+enc(date)+'&party_size='+party, false),
      getJson('/restaurants/'+enc(rid), false)
    ]).then(function(r){
      if(seq!==searchSeq) return;
      if(!r[0].ok){ return; }
      currentSearch={ rid:rid, date:date, party:party, av:r[0].body, rest:(r[1].ok?r[1].body:null) };
      renderGrid();
    });
  }

  function renderGrid(){
    var results=document.getElementById('results'); results.innerHTML='';
    var av=currentSearch.av, rest=currentSearch.rest;
    if(!av || !av.slots || av.slots.length===0){
      var n=document.createElement('div'); n.setAttribute('data-testid','no-slots'); n.className='empty'; n.textContent='No available times for that day.'; results.appendChild(n); return;
    }
    var tables=(rest&&rest.tables)?rest.tables:[];
    var pairs=(rest&&rest.combinable)?rest.combinable:[];
    var grid=document.createElement('div'); grid.setAttribute('data-testid','availability-grid'); grid.className='grid';
    av.slots.forEach(function(slot){
      var at=hhmmOf(slot.starts_at_local);
      var availableIds=slot.available_table_ids||[];
      var options=slot.available_options||[];
      var availByKey={}; options.forEach(function(o){ availByKey[o.table_ids.join('+')]=o; });
      var col=document.createElement('div'); col.className='col';
      var head=document.createElement('div'); head.className='colhead'; head.textContent=at; col.appendChild(head);
      tables.forEach(function(t){
        var isAv=availableIds.indexOf(t.id)>=0;
        var cell=document.createElement('button'); cell.type='button';
        cell.setAttribute('data-testid','slot-'+t.id+'-'+at);
        cell.setAttribute('data-available', isAv?'true':'false'); cell.textContent=t.label;
        if(isAv){ cell.addEventListener('click', function(){ openBooking({ tableIds:[t.id], labels:[t.label], at:at }); }); } else { cell.disabled=true; }
        col.appendChild(cell);
      });
      pairs.forEach(function(pair){
        var labels=[], sum=0, ok=true;
        pair.forEach(function(id){ var t=findTable(tables,id); if(!t){ ok=false; return; } labels.push(t.label); sum+=t.capacity; });
        if(!ok || sum<currentSearch.party) return;
        var key=pair.join('+'); var isAv=!!availByKey[key];
        var cell=document.createElement('button'); cell.type='button'; cell.className='cell combo';
        cell.setAttribute('data-testid','slot-'+key+'-'+at);
        cell.setAttribute('data-available', isAv?'true':'false'); cell.textContent=labels.join(' + ');
        if(isAv){ cell.addEventListener('click', function(){ openBooking({ tableIds:pair.slice(), labels:labels.slice(), at:at }); }); } else { cell.disabled=true; }
        col.appendChild(cell);
      });
      grid.appendChild(col);
    });
    results.appendChild(grid);
  }

  // ---- booking ------------------------------------------------------------
  function canonicalFor(party){ return JSON.stringify([booking.restaurantId, booking.tableIds, booking.startsAtLocal, party]); }
  function clearConfirmation(){ var e=$('confirmation'); if(e) e.remove(); }
  function clearError(){ var e=$('booking-error'); if(e) e.remove(); }
  function clearUncertain(){ var e=$('booking-uncertain'); if(e) e.remove(); }
  function bookingHost(){ return document.getElementById('booking'); }
  function showError(msg){ clearError(); var h=bookingHost(); if(!h) return; var d=document.createElement('div'); d.setAttribute('data-testid','booking-error'); d.className='error'; d.textContent=msg; h.appendChild(d); }
  function showUncertain(){ clearUncertain(); var h=bookingHost(); if(!h) return; var d=document.createElement('div'); d.setAttribute('data-testid','booking-uncertain'); d.className='uncertain'; d.textContent='We could not confirm your booking. Check your connection and press Book again.'; h.appendChild(d); }

  function openBooking(info){
    if(!tok()){ makeAuthError('Please log in or sign up to book a table.'); return; }
    if(!currentSearch) return;
    booking={ restaurantId:currentSearch.rid, restaurantName:(currentSearch.rest?currentSearch.rest.name:''), tableIds:info.tableIds, tableLabels:info.labels, startsAtLocal:currentSearch.date+'T'+info.at, key:newKey(), canonical:null };
    booking.canonical=canonicalFor(currentSearch.party);
    renderBookingForm(currentSearch.party);
  }

  function renderBookingForm(party){
    var h=bookingHost(); h.innerHTML='';
    var form=document.createElement('div'); form.setAttribute('data-testid','booking-form'); form.className='panel';
    var sum=document.createElement('p'); sum.setAttribute('data-testid','booking-summary');
    sum.textContent='Table '+booking.tableLabels.join(' + ')+' \u00b7 '+booking.startsAtLocal.slice(11,16)+' on '+booking.startsAtLocal.slice(0,10);
    form.appendChild(sum);
    var lab=document.createElement('label'); lab.className='field'; lab.textContent='Party size';
    var inp=document.createElement('input'); inp.type='number'; inp.min='1'; inp.setAttribute('data-testid','booking-party-size'); inp.value=String(party); lab.appendChild(inp); form.appendChild(lab);
    var b=document.createElement('button'); b.type='button'; b.className='primary'; b.setAttribute('data-testid','booking-submit'); b.textContent='Book this table';
    b.addEventListener('click', submitBooking); form.appendChild(b);
    h.appendChild(form);
  }

  function showConfirmation(data){
    var h=bookingHost(); var old=$('confirmation'); if(old) old.remove();
    var c=document.createElement('div'); c.setAttribute('data-testid','confirmation'); c.className='panel success';
    var r=document.createElement('div'); r.setAttribute('data-testid','confirmation-reference'); r.textContent=String(data.reference||''); c.appendChild(r);
    var d=document.createElement('div'); d.setAttribute('data-testid','confirmation-details');
    d.textContent=booking.restaurantName+' \u00b7 Table '+booking.tableLabels.join(' + ')+' \u00b7 '+booking.startsAtLocal.slice(11,16); c.appendChild(d);
    var t=document.createElement('div'); t.setAttribute('data-testid','confirmation-tables'); t.textContent=booking.tableLabels.join(', '); c.appendChild(t);
    h.appendChild(c); clearError(); clearUncertain();
  }

  function submitBooking(){
    if(!booking) return;
    var party=parseInt($('booking-party-size').value,10); if(!(party>0)) party=1;
    var canonical=canonicalFor(party);
    if(canonical!==booking.canonical){ booking.key=newKey(); booking.canonical=canonical; clearConfirmation(); }
    clearError(); clearUncertain();
    var body={ restaurant_id:booking.restaurantId, table_ids:booking.tableIds, starts_at_local:booking.startsAtLocal, party_size:party };
    sendJson('POST','/reservations', body, true, booking.key).then(function(res){
      if(res.ok){ showConfirmation(res.body); }
      else if(res.status===409 && res.body && res.body.error && res.body.error.code==='table_unavailable'){ showError('That table was just taken. Please choose another time.'); doSearch(); }
      else { showError(errMsg(res)); }
    }).catch(function(){ showUncertain(); });
  }

  // ---- lookup -------------------------------------------------------------
  function clearReservation(){ var e=$('reservation-detail'); if(e) e.remove(); var r=$('reservation-error'); if(r) r.remove(); }
  function showReservationError(){ var h=document.getElementById('lookup-result'); var old=$('reservation-detail'); if(old) old.remove(); var e=document.createElement('div'); e.setAttribute('data-testid','reservation-error'); e.className='error'; e.textContent='No reservation found for that reference.'; h.appendChild(e); }
  function renderReservation(r){
    getJson('/restaurants/'+enc(r.restaurant_id), false).then(function(res){
      var map={}; if(res.ok && res.body && res.body.tables){ res.body.tables.forEach(function(t){ map[t.id]=t.label; }); }
      var labels=(r.table_ids||[]).map(function(id){ return map[id]||id; });
      var h=document.getElementById('lookup-result'); h.innerHTML='';
      var d=document.createElement('div'); d.setAttribute('data-testid','reservation-detail'); d.className='panel';
      var s=document.createElement('div'); s.setAttribute('data-testid','reservation-status'); s.textContent=r.status; d.appendChild(s);
      var tb=document.createElement('div'); tb.setAttribute('data-testid','reservation-tables'); tb.textContent=labels.join(', '); d.appendChild(tb);
      var when=document.createElement('div'); when.textContent=r.starts_at_local.replace('T',' at '); d.appendChild(when);
      if(r.status==='confirmed'){
        var b=document.createElement('button'); b.type='button'; b.setAttribute('data-testid','reservation-cancel-button'); b.textContent='Cancel reservation';
        b.addEventListener('click', function(){ cancelReservation(r.reference, d); }); d.appendChild(b);
      }
      h.appendChild(d);
    });
  }
  function cancelReservation(reference, detail){
    sendJson('POST','/reservations/'+enc(reference)+'/cancel', null, true, null).then(function(res){
      if(res.ok){ var s=detail.querySelector('[data-testid=\'reservation-status\']'); if(s) s.textContent=res.body.status; var b=detail.querySelector('[data-testid=\'reservation-cancel-button\']'); if(b) b.remove(); }
      else { showReservationError(); }
    }).catch(function(){ showReservationError(); });
  }

  // ---- auth pages ---------------------------------------------------------
  function initSignup(){
    $('signup-submit').addEventListener('click', function(){
      removeAuthError();
      sendJson('POST','/auth/signup',{ email:$('signup-email').value, password:$('signup-password').value, display_name:$('signup-display-name').value }, false, null).then(function(res){
        if(res.ok){ setSession(res.body.token, res.body.display_name); location.href='/'; } else { makeAuthError(errMsg(res)); }
      }).catch(function(){ makeAuthError('Something went wrong. Please try again.'); });
    });
  }
  function initLogin(){
    $('login-submit').addEventListener('click', function(){
      removeAuthError();
      sendJson('POST','/auth/login',{ email:$('login-email').value, password:$('login-password').value }, false, null).then(function(res){
        if(res.ok){ setSession(res.body.token, res.body.display_name); location.href='/'; } else { makeAuthError(errMsg(res)); }
      }).catch(function(){ makeAuthError('Something went wrong. Please try again.'); });
    });
  }

  function init(){
    renderSession();
    var route=document.body.getAttribute('data-route');
    if(route==='search'){
      var dateInput=$('date-input'); if(dateInput && !dateInput.value){ var d=new Date(Date.now()+7*86400000); dateInput.value=d.toISOString().slice(0,10); }
      var partyInput=$('party-size-input'); if(partyInput && !partyInput.value){ partyInput.value='2'; }
      var btn=$('search-button'); if(btn) btn.addEventListener('click', doSearch);
    } else if(route==='signup'){ initSignup(); }
    else if(route==='login'){ initLogin(); }
    else if(route==='lookup'){ var lb=$('lookup-submit'); if(lb) lb.addEventListener('click', function(){ clearReservation(); var ref=$('lookup-reference-input').value.trim(); getJson('/reservations/'+enc(ref), true).then(function(res){ if(res.ok){ renderReservation(res.body); } else { showReservationError(); } }).catch(showReservationError); }); }
  }

  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
`;

function shell(route: string, main: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tablekeeper</title>
<style>${STYLE}</style>
</head>
<body data-route="${route}">
<header>
<a class="brand" href="/">Tablekeeper</a>
<nav>
<a href="/">Search</a>
<a href="/lookup">Lookup</a>
<a href="/signup">Sign up</a>
<a href="/login">Login</a>
</nav>
<div id="session"></div>
</header>
<main>
<div id="auth"></div>
${main}
</main>
<script>${SCRIPT}</script>
</body>
</html>`;
}

export function renderPage(route: string, state: State): string | null {
  if (route === 'search') {
    return shell('search', `
<section class="panel">
<h1>Find a table</h1>
<div class="row">
<label class="field">Restaurant
<select data-testid="restaurant-select">${restaurantOptions(state)}</select>
</label>
<label class="field">Date
<input type="date" data-testid="date-input">
</label>
<label class="field">Party size
<input type="number" min="1" inputmode="numeric" data-testid="party-size-input">
</label>
<button type="button" class="primary" data-testid="search-button">Search</button>
</div>
</section>
<div id="results"></div>
<div id="booking"></div>`);
  }
  if (route === 'signup') {
    return shell('signup', `
<section class="panel">
<h1>Create your account</h1>
<label class="field">Email
<input type="email" data-testid="signup-email" autocomplete="email">
</label>
<label class="field">Password
<input type="password" data-testid="signup-password" autocomplete="new-password">
</label>
<label class="field">Display name
<input type="text" data-testid="signup-display-name" autocomplete="name">
</label>
<button type="button" class="primary" data-testid="signup-submit">Create account</button>
</section>`);
  }
  if (route === 'login') {
    return shell('login', `
<section class="panel">
<h1>Log in</h1>
<label class="field">Email
<input type="email" data-testid="login-email" autocomplete="email">
</label>
<label class="field">Password
<input type="password" data-testid="login-password" autocomplete="current-password">
</label>
<button type="button" class="primary" data-testid="login-submit">Log in</button>
</section>`);
  }
  if (route === 'lookup') {
    return shell('lookup', `
<section class="panel">
<h1>Look up a reservation</h1>
<label class="field">Reference
<input type="text" data-testid="lookup-reference-input">
</label>
<button type="button" class="primary" data-testid="lookup-submit">Look up</button>
</section>
<div id="lookup-result"></div>`);
  }
  return null;
}
