(function(root) {
  function destination(value, host) {
    const url=new URL(value);
    if(url.protocol!=='https:' || url.hostname!==host || url.port || url.username || url.password) throw Error('Unerwartete Checkout-Adresse.');
    return url.href;
  }
  function create({request,byId,message,onActivated,location=root.location,history=root.history,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),maxPolls=20}) {
    let account=null,epoch=0,polling=false,planReady=false;
    const show=text=>{byId('billingStatus').textContent=text;};
    const params=()=>new URLSearchParams(location.search || '');
    const existing=()=>account?.subscription && !['canceled','incomplete_expired'].includes(account.subscription.status);
    async function render(value) {
      account=value; const current=++epoch; planReady=false;
      byId('checkout').disabled=true;byId('portal').disabled=true;
      byId('checkoutConsent').checked=false;byId('checkoutConsentRow').hidden=true;
      byId('checkout').hidden=Boolean(existing());byId('portal').hidden=!account?.subscription;
      byId('billingRetry').hidden=true;
      if(!account){show('');return;}
      byId('proDescription').textContent='Stripe-Testcheckout wird geprüft …';
      try {
        const config=await request('/config'); if(current!==epoch)return;
        if(!config.billingAvailable || config.billingMode!=='test') {
          byId('checkout').textContent='Pro · noch nicht eingerichtet';
          byId('proDescription').textContent='Testcheckout ist noch nicht eingerichtet. Deine gespeicherten Reports bleiben lesbar.';return;
        }
        byId('portal').disabled=false;
        byId('portal').textContent='Test-Abo verwalten';
        if(existing()) {
          byId('proDescription').textContent=`Stripe-Testmodus · ${config.proMonthlyAnalyses} Analysen je bezahltem Monat. Keine echten Abbuchungen. Marktdaten nicht enthalten.`;return;
        }
        const plan=await request('/billing/plan'); if(current!==epoch)return;
        if(plan.mode!=='test' || plan.interval!=='month')throw Error('Unbekannter Abomodus.');
        const formatter=new Intl.NumberFormat('de-CH',{style:'currency',currency:plan.currency});
        const amount=formatter.format(plan.amount / 10 ** formatter.resolvedOptions().maximumFractionDigits);
        byId('checkout').textContent='Pro im Testmodus starten';
        byId('proDescription').textContent=`Test-Abo: ${amount} / Monat · ${plan.monthlyAnalyses} neue Analysen je Abrechnungsmonat, kein Übertrag. Nicht genutzte Gratisanalyse bleibt erhalten. Keine echten Abbuchungen. Marktdaten nicht enthalten.`;
        byId('checkoutConsentRow').hidden=false;planReady=true;
      }catch(error){if(current===epoch)byId('proDescription').textContent=error.message;}
    }
    byId('checkoutConsent').addEventListener('change',()=>{byId('checkout').disabled=!planReady || !byId('checkoutConsent').checked;});
    byId('checkout').addEventListener('click',async()=>{
      if(byId('checkout').disabled || !planReady || !account || !byId('checkoutConsent').checked)return;
      const current=epoch;byId('checkout').disabled=true;
      try {const result=await request('/billing/checkout',{confirmSubscription:true});if(current!==epoch)return;
        if(result.mode!=='test')throw Error('Nur Testzahlungen sind freigegeben.');
        location.assign(destination(result.url,'checkout.stripe.com'));
      }catch(error){if(current===epoch){show(error.message);byId('checkout').disabled=false;}}
    });
    byId('portal').addEventListener('click',async()=>{
      if(byId('portal').disabled || !account)return;
      const current=epoch;byId('portal').disabled=true;
      try{const result=await request('/billing/portal',{});if(current!==epoch)return;
        if(result.mode!=='test')throw Error('Nur Test-Abos sind freigegeben.');
        location.assign(destination(result.url,'billing.stripe.com'));
      }catch(error){if(current===epoch){show(error.message);byId('portal').disabled=false;}}
    });
    async function handleReturn() {
      const query=params();
      if(query.get('checkout')==='cancel'){show('Checkout abgebrochen. Keine Freischaltung durch diese Rückkehr.');history.replaceState(null,'',location.pathname);return;}
      if(query.get('upgrade')==='1' || location.hash==='#profile')byId('profileMenu').open=true;
      if(query.get('checkout')!=='success' || polling)return;
      if(!account){message('Bitte anmelden, um den Test-Checkout deinem Konto zuzuordnen.');return;}
      const current=epoch;polling=true;byId('billingRetry').hidden=true;
      show('Testzahlung wird serverseitig bestätigt …');
      try {
        for(let n=0;n<maxPolls;n++) {
          if(current!==epoch)return;
          const result=await request(`/billing/checkout-status?session_id=${encodeURIComponent(query.get('session_id') || '')}`);
          if(current!==epoch)return;
          if(result.status==='active' && result.account?.plan==='pro') {
            history.replaceState(null,'',location.pathname);show('Pro im Testmodus ist aktiv.');
            message('Pro im Testmodus freigeschaltet.');await onActivated();return;
          }
          if(n+1<maxPolls)await delay(1500);
        }
        show('Bestätigung steht noch aus. Bei laufendem Stripe-Webhook-Listener Status erneut prüfen; nicht erneut bezahlen.');
        byId('billingRetry').hidden=false;
      }catch(error){if(current===epoch){show(error.message);byId('billingRetry').hidden=false;}}
      finally{polling=false;}
    }
    byId('billingRetry').addEventListener('click',handleReturn);
    return {render,handleReturn};
  }
  const api={create,destination};
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.ProBilling=api;
})(globalThis);
