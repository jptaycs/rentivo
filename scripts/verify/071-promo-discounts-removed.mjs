// Proves promo codes no longer discount anything, even when a code is ACTIVE.
// Temporarily reactivates RENTIVO10 for the probe and restores it to inactive.
// Usage: node --experimental-strip-types scripts/verify/071-promo-discounts-removed.mjs

import { URL as U, ANON, SECRET, admin, check, done } from './env.mjs'
const stamp=Date.now(); const made={u:[],l:[],b:[]}
const mk=async(e)=>{const r=await fetch(`${U}/auth/v1/admin/users`,{method:'POST',headers:{apikey:SECRET,Authorization:`Bearer ${SECRET}`,'Content-Type':'application/json'},body:JSON.stringify({email:e,password:'ProbeRentivo1',email_confirm:true})});const j=await r.json();made.u.push(j.id);return j.id}
const del=(id)=>fetch(`${U}/auth/v1/admin/users/${id}`,{method:'DELETE',headers:{apikey:SECRET,Authorization:`Bearer ${SECRET}`}})
const tok=async(e)=>{const r=await fetch(`${U}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:ANON,'Content-Type':'application/json'},body:JSON.stringify({email:e,password:'ProbeRentivo1'})});return (await r.json()).access_token}
const h=await mk(`p71h-${stamp}@example.com`), r=await mk(`p71r-${stamp}@example.com`)
await admin(`profiles?id=eq.${h}`,{method:'PATCH',body:JSON.stringify({full_name:'P71 Host',is_host:true,is_verified:true})})
await admin(`profiles?id=eq.${r}`,{method:'PATCH',body:JSON.stringify({full_name:'P71 Renter'})})
const {body:L}=await admin('listings',{method:'POST',body:JSON.stringify({host_id:h,title:`P71 ${stamp}`,brand:'Sony',model:'A7',category:'mirrorless',condition:'excellent',description:'probe',daily_price:1000,security_deposit:5000,city:'Manila',province:'Metro Manila',images:['https://images.unsplash.com/photo-1516035069371-29a1b244cc32'],is_active:true,is_draft:false,latitude:14.6,longitude:120.98,location_is_exact:true})})
made.l.push(L[0].id)
// reactivate a code ONLY for this probe, then restore
await admin(`promo_codes?code=eq.RENTIVO10`,{method:'PATCH',body:JSON.stringify({is_active:true})})
const t=await tok(`p71r-${stamp}@example.com`)
const res=await fetch(`${U}/rest/v1/rpc/create_booking`,{method:'POST',headers:{apikey:ANON,Authorization:`Bearer ${t}`,'Content-Type':'application/json'},body:JSON.stringify({p_listing_id:L[0].id,p_pickup_date:'2027-06-01',p_return_date:'2027-06-03',p_is_delivery:false,p_delivery_address:null,p_payment_method:'qrph',p_promo_code:'RENTIVO10',p_renter_notes:null})})
const b=await res.json(); if(b?.id) made.b.push(b.id)
check('booking created even though a code was sent', res.status===200 && !!b?.id, JSON.stringify(b).slice(0,120))
check('an ACTIVE code no longer produces a discount', b.discount===0, `discount=${b.discount}`)
check('promo_code is not recorded', b.promo_code===null, `promo_code=${b.promo_code}`)
check('total = rental + service, undiscounted', b.total_amount===2100, `${b.rental_fee}+${b.service_fee}=${b.total_amount}`)
const {body:pc}=await admin(`promo_codes?select=code,used_count&code=eq.RENTIVO10`)
check('used_count was NOT incremented', pc[0].used_count===3, `used_count=${pc[0].used_count}`)
await admin(`promo_codes?code=eq.RENTIVO10`,{method:'PATCH',body:JSON.stringify({is_active:false})})
const {body:act}=await admin('promo_codes?select=code&is_active=eq.true')
check('all codes restored to inactive', act.length===0)
const rv=await fetch(`${U}/rest/v1/rpc/validate_promo_code`,{method:'POST',headers:{apikey:ANON,Authorization:`Bearer ${t}`,'Content-Type':'application/json'},body:JSON.stringify({p_code:'RENTIVO10'})})
check('validate_promo_code is revoked for authenticated', rv.status===403||rv.status===404, `HTTP ${rv.status}`)
for(const x of made.b) await admin(`bookings?id=eq.${x}`,{method:'DELETE'})
for(const x of made.l) await admin(`listings?id=eq.${x}`,{method:'DELETE'})
for(const x of made.u){await admin(`notifications?user_id=eq.${x}`,{method:'DELETE'});await admin(`conversations?or=(renter_id.eq.${x},host_id.eq.${x})`,{method:'DELETE'});await admin(`profiles?id=eq.${x}`,{method:'DELETE'});await del(x)}
const {body:fb}=await admin('bookings?booking_ref=eq.RNT-A4DA55&select=promo_code,discount')
check('historical discounted booking untouched', fb[0].promo_code==='CREATOR20' && fb[0].discount===120, JSON.stringify(fb[0]))
done()
