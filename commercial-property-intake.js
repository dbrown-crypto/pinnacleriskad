(function () {
  'use strict';
  var form = document.getElementById('commercial-property-form');
  if (!form) return;
  var steps = Array.from(form.querySelectorAll('.wizard-step'));
  var current = 0, busy = false;
  var names = ['Contact','Property','Coverage','Review'];
  var key = 'commercial-property-quote';
  try {
    if (sessionStorage.getItem('pra_quote:' + key + ':complete_sent') === 'true') {
      ['submission_id','started_at_ms','partial_sent','partial_attempts','complete_sent'].forEach(function (item) { sessionStorage.removeItem('pra_quote:' + key + ':' + item); });
    }
  } catch (error) { /* The shared helper supports storage being unavailable. */ }
  var session = PinnacleQuote.createSession({formKey:key,lineOfBusiness:'commercial'});
  function el(id) { return document.getElementById(id); }
  function value(id) { return el(id).disabled ? '' : el(id).value.trim(); }
  function toggle(id, visible) {
    var panel = el(id); panel.hidden = !visible;
    panel.querySelectorAll('input,select,textarea').forEach(function (control) { control.disabled = !visible; });
  }
  function sync() {
    toggle('vacancy-panel',['Vacant','Partially occupied'].includes(value('occupancy')));
    toggle('renovation-panel',value('occupancy') === 'Under renovation');
    toggle('florida-panel',value('state') === 'Florida');
    toggle('portfolio-panel',el('multiple_properties').checked);
    toggle('insured-panel',value('currently_insured') === 'Yes');
    toggle('claims-panel',value('claims') === 'Yes');
    toggle('lapse-panel',value('lapse') === 'Yes');
    var tenant = value('ownership') === 'I lease space for my business';
    var coverage = value('coverage_needs');
    toggle('building-panel',!tenant && coverage !== 'Business contents / tenant improvements');
    toggle('contents-panel',coverage !== 'Building only');
    el('effective_date').disabled = el('effective_date_unknown').checked;
    if (current === 3) review();
  }
  function show(step, focus) {
    current = step;
    steps.forEach(function (panel,i) { panel.hidden = i !== step; });
    form.querySelectorAll('[data-progress]').forEach(function (item,i) { if (i===step) item.setAttribute('aria-current','step'); else item.removeAttribute('aria-current'); });
    el('wizard-status').textContent = 'Step ' + (step+1) + ' of 4: ' + names[step];
    el('wizard-back').hidden = step === 0;
    el('wizard-next').hidden = step === 3;
    el('submit-btn').hidden = step !== 3;
    el('wizard-next').textContent = step === 2 ? 'Review My Request' : 'Continue to ' + names[step+1];
    if (step === 3) review();
    if (focus !== false) { el('step-title-'+step).focus({preventScroll:true}); el('quote-form').scrollIntoView({behavior:'smooth',block:'start'}); }
  }
  function validate(step) {
    if (step === 0) {
      ['firstName','lastName','company'].forEach(function (id) { el(id).setCustomValidity(value(id) ? '' : 'Please enter this information.'); });
      var digits = value('phone').replace(/\D/g,'');
      el('phone').setCustomValidity(/^(?:1)?\d{10}$/.test(digits) ? '' : 'Please enter a 10-digit US phone number.');
    }
    ['property_address','operations','roof_age','vacancy_length','vacancy_plan','renovation_work','claims_details','lapse_details'].forEach(function (id) { el(id).setCustomValidity(el(id).disabled || !el(id).required || value(id) ? '' : 'Please enter this information.'); });
    var invalid = Array.from(steps[step].querySelectorAll('input,select,textarea')).find(function (control) { return !control.disabled && !control.checkValidity(); });
    if (invalid) { show(step,false); invalid.focus(); invalid.reportValidity(); return false; }
    return true;
  }
  function answerRows(step) {
    return Array.from(steps[step].querySelectorAll('input,select,textarea')).filter(function (control) { return !control.disabled && control.id && control.type !== 'hidden'; }).map(function (control) {
      var label = form.querySelector('label[for="'+control.id+'"]');
      var name = (label ? label.textContent : control.id).replace(/\s*\*\s*$/,'').trim();
      var answer = control.type === 'checkbox' ? (control.checked ? 'Yes' : 'No') : control.value.trim();
      if (control.tagName === 'SELECT' && answer) answer = control.options[control.selectedIndex].textContent;
      if (!answer) answer = 'Not provided / follow up';
      return [name,answer];
    });
  }
  function addRow(list,label,answer) {
    var row = document.createElement('div'); row.className='review-row';
    var dt=document.createElement('dt');dt.textContent=label;
    var dd=document.createElement('dd');dd.textContent=answer;
    row.append(dt,dd);list.appendChild(row);
  }
  function review() {
    var container=el('quote-review');container.replaceChildren();
    for (var i=0;i<3;i++) {
      var group=document.createElement('div');group.className='review-group';
      var head=document.createElement('div');head.className='review-head';
      var title=document.createElement('h4');title.textContent=names[i];
      var edit=document.createElement('button');edit.type='button';edit.className='review-edit';edit.textContent='Edit';edit.setAttribute('aria-label','Edit '+names[i]);
      edit.addEventListener('click',function(step){return function(){if(!busy)show(step);};}(i));
      head.append(title,edit);group.appendChild(head);
      var list=document.createElement('dl');answerRows(i).forEach(function(pair){addRow(list,pair[0],pair[1]);});
      if(i===2 && el('effective_date_unknown').checked)addRow(list,'Desired coverage start date','Not sure yet');
      group.appendChild(list);container.appendChild(group);
    }
  }
  function receipt(answers,reference,at,sms) {
    var article=el('submission-receipt');article.replaceChildren();
    function add(tag,text,cls){var node=document.createElement(tag);node.textContent=text;if(cls)node.className=cls;article.appendChild(node);}
    add('p','Pinnacle Risk Advisors LLC','receipt-brand');
    add('h3','Commercial Property Quote Request — Your Copy');
    add('p','Submitted: '+new Date(at).toLocaleString('en-US',{timeZoneName:'short'})+'\nRequest reference: '+reference,'receipt-meta');
    article.appendChild(answers);
    add('p','Service text consent: '+(sms?'Yes':'No'));
    add('p','This copy records your submitted answers. It is a quote request, not an insurance policy, quote, or binder. Coverage is not bound by this request.');
    add('p','Derrick Brown | (770) 758-3197 | dbrown@pinnacleriskad.com','receipt-meta');
    article.hidden=false;el('success-screen').classList.add('receipt-ready');
  }
  el('wizard-next').addEventListener('click',function(){if(!busy&&validate(current))show(Math.min(3,current+1));});
  el('wizard-back').addEventListener('click',function(){if(!busy)show(Math.max(0,current-1));});
  ['ownership','state','occupancy','coverage_needs','currently_insured','claims','lapse','multiple_properties','effective_date_unknown'].forEach(function(id){el(id).addEventListener('change',sync);});
  form.addEventListener('submit',async function(event){
    event.preventDefault();if(busy)return;
    if(current<3){if(validate(current))show(current+1);return;}
    for(var i=0;i<4;i++)if(!validate(i))return;
    review();
    var answers=el('quote-review').cloneNode(true);answers.removeAttribute('id');answers.removeAttribute('aria-live');answers.querySelectorAll('button').forEach(function(button){button.remove();});
    var at=new Date().toISOString(),sms=el('smsService').checked;
    var details='COMMERCIAL PROPERTY QUOTE REQUEST\n';
    for(var j=0;j<3;j++)details+='\n'+names[j].toUpperCase()+'\n'+answerRows(j).map(function(pair){return pair[0]+': '+pair[1];}).join('\n')+'\n';
    if(el('effective_date_unknown').checked)details+='Desired coverage start date: Not sure yet\n';
    details+='Service text consent: '+(sms?'Yes':'No')+'\nDocuments to be sent separately by email.';
    var fields={firstName:value('firstName'),lastName:value('lastName'),company:value('company'),phone:value('phone'),email:value('email'),state:value('state')==='Florida'?'FL':'GA',coverage:'property',coverage_type:'Commercial Property Insurance',line_of_business:'Commercial Property Insurance',form:'commercial_property_quote',form_page:'/commercial-property-insurance-quote',source:'website',lead_source:'Website Commercial Property Quote Page',submitted_at:at,description:value('property_address'),details:details,notes:details,files_noted:'Commercial property: '+value('property_address')+'; '+value('property_type')+'; '+value('ownership')+'; Roof: '+value('roof_age')+'; Construction: '+value('construction')+'. Full answers are in the submission details.',smsService:sms?'yes':'',smsServiceConsent:sms?'yes':'no',smsMarketingConsent:'no',smsOptInTimestamp:sms?at:'',smsOptInSource:sms?'Website Commercial Property Quote Page':'',smsOptInPageUrl:sms?location.href:'',smsDisclosureVersion:'commercial-property-service-v1'};
    busy=true;form.querySelectorAll('button').forEach(function(button){button.disabled=true;});el('submit-btn').textContent='Sending...';PinnacleQuote.clearFailure(form);
    try {
      var result=await session.submitComplete(fields,value('website'));
      receipt(answers,result.submission_id||session.submissionId,at,sms);
      form.style.display='none';el('success-screen').style.display='block';
      el('receipt-status').textContent=sms?'An acknowledgment email and confirmation text are on their way.':'An acknowledgment email is on its way.';
      el('success-screen').scrollIntoView({behavior:'smooth',block:'start'});
    } catch(error) {
      PinnacleQuote.logDiagnostic('commercial_property_submit_failed',error);PinnacleQuote.showFailure(form,error);
      busy=false;form.querySelectorAll('button').forEach(function(button){button.disabled=false;});el('submit-btn').textContent='Send My Quote Request';
    }
  });
  var originalTitle;
  window.addEventListener('beforeprint',function(){if(!el('submission-receipt').hidden){originalTitle=document.title;document.title='Pinnacle-Commercial-Property-Request-'+new Date().toISOString().slice(0,10);}});
  window.addEventListener('afterprint',function(){if(originalTitle){document.title=originalTitle;originalTitle='';}});
  var stateHint=new URLSearchParams(location.search).get('state');
  if(stateHint==='GA')el('state').value='Georgia';if(stateHint==='FL')el('state').value='Florida';
  sync();show(0,false);
})();
