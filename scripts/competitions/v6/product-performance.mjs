import {canonicalHash} from './frozen-ranking-executor.mjs';

export function readAccountingTrace(log){
  return log.split(/\r?\n/).flatMap(line=>{
    let row;try{row=JSON.parse(line);}catch{return [];}
    return row?.event==='competition_accounting_trace'?[row]:[];
  });
}

/** Stable student semantics only; labels, IDs and timestamps cannot create a new profile. */
export function performanceProfileSemantics(profile,{registered=false}={}){
  const keys=['schemaVersion','facts','unknownFields','goals','primaryGoal','tradeoffStatus','mode'];
  if(!profile||profile.schemaVersion!==(registered?'saitu.performance-profile.v1':'saitu.profile.v6')
    ||registered&&Object.keys(profile).some(key=>!keys.includes(key))||!Array.isArray(profile.facts)
    ||!Array.isArray(profile.unknownFields)||!Array.isArray(profile.goals)||!['quick','deep'].includes(profile.mode)
    ||!['confirmed','undecided','not_needed'].includes(profile.tradeoffStatus)
    ||profile.primaryGoal!==null&&typeof profile.primaryGoal!=='string')throw new Error('strict_performance_profile_required');
  const facts=profile.facts.filter(f=>registered||!(profile.retractedFactIds??[]).includes(f.id)).map(f=>{
    if(!f||registered&&Object.keys(f).some(key=>!['field','value','state','confirmed','evidenceLevel'].includes(key))
      ||typeof f.field!=='string'||!f.field||!['string','number','boolean'].includes(typeof f.value)
      ||typeof f.value==='number'&&!Number.isFinite(f.value)||typeof f.confirmed!=='boolean'
      ||!['affirmed','negated','unknown','conditional','retracted'].includes(f.state)
      ||!['self_report','concrete_experience','unknown'].includes(f.evidenceLevel))throw new Error('strict_performance_fact_required');
    return {field:f.field,value:f.value,state:f.state,confirmed:f.confirmed,evidenceLevel:f.evidenceLevel};
  }).sort((a,b)=>canonicalHash(a).localeCompare(canonicalHash(b)));
  const strings=values=>{if(values.some(v=>typeof v!=='string'||!v)||new Set(values).size!==values.length)throw new Error('invalid_performance_profile_values');return [...values].sort();};
  if(new Set(facts.map(canonicalHash)).size!==facts.length)throw new Error('duplicate_performance_fact');
  return {schemaVersion:'saitu.performance-profile.v1',facts,unknownFields:strings(profile.unknownFields),goals:strings(profile.goals),primaryGoal:profile.primaryGoal,tradeoffStatus:profile.tradeoffStatus,mode:profile.mode};
}

export function validatePerformanceRegistration(input){
  if(input.schemaVersion!=='saitu.browser-performance-registration.v1'||!['development','formal'].includes(input.purpose)||input.latencyClock!=='confirmed_submission_to_browser_report'||input.retries!==0||!Number.isInteger(input.timeoutMs)||input.timeoutMs<45000||input.timeoutMs>180000)throw new Error('explicit_performance_protocol_required');
  if(!Array.isArray(input.journeys)||!input.journeys.length)throw new Error('performance_journeys_required');
  const ids=new Set(),profiles=new Map(),inputs=new Map();
  for(const journey of input.journeys){
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(journey.journeyId??'')||ids.has(journey.journeyId)||!journey.profileId||!['desktop','mobile'].includes(journey.viewport)||!['quick','deep'].includes(journey.flow)||!journey.profileInput||!Array.isArray(journey.steps)||!journey.steps.length||journey.steps.filter(s=>s.startDecisionClock===true).length!==1)throw new Error('invalid_performance_journey');
    ids.add(journey.journeyId);
    const semantic=input.purpose==='formal'?performanceProfileSemantics(journey.profileInput,{registered:true}):journey.profileInput;
    if(input.purpose==='formal'&&semantic.mode!==journey.flow)throw new Error('registered_profile_flow_mismatch');
    const hash=canonicalHash(semantic);
    if(profiles.has(journey.profileId)&&profiles.get(journey.profileId)!==hash)throw new Error('profile_identity_changed_between_viewports');
    if(inputs.has(hash)&&inputs.get(hash)!==journey.profileId)throw new Error('duplicate_input_relabelled_as_new_profile');
    profiles.set(journey.profileId,hash);inputs.set(hash,journey.profileId);
    for(const step of journey.steps){
      if(!['click','check','choose','fill','select','waitVisible','followups'].includes(step.action)||typeof step.selector!=='string'||!step.selector||step.startDecisionClock&&step.action!=='click')throw new Error('unsupported_performance_step');
      if(['fill','select'].includes(step.action)&&typeof step.value!=='string')throw new Error('step_value_required');
      if(step.action==='followups'&&(!Array.isArray(step.answers)||input.purpose==='formal'&&step.developmentFirstChoice))throw new Error('registered_followup_answers_required');
    }
  }
  const counts={journeys:input.journeys.length,profiles:profiles.size,desktop:input.journeys.filter(j=>j.viewport==='desktop').length,mobile:input.journeys.filter(j=>j.viewport==='mobile').length};
  if(input.purpose==='formal'&&(counts.journeys<100||counts.profiles<60||counts.desktop<50||counts.mobile<50||!input.journeys.some(j=>j.flow==='quick')||!input.journeys.some(j=>j.flow==='deep')||!input.profileIndependenceReviewSha256?.match(/^[a-f0-9]{64}$/)))throw new Error('formal_performance_requires_100_runs_60_reviewed_profiles_50_each_viewport_both_flows');
  if(input.purpose==='formal'&&![input.implementationSha256,input.runtimeConfigurationSha256].every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)))throw new Error('formal_performance_requires_source_and_runtime_freeze');
  return counts;
}

export function validatePerformanceProfileReview(registration,review){
  validatePerformanceRegistration(registration);
  const expected=new Map(registration.journeys.map(j=>[j.profileId,canonicalHash(performanceProfileSemantics(j.profileInput,{registered:true}))]));
  const contexts=[review?.authorContextId,...(review?.reviewerContextIds??[])];
  if(review?.schemaVersion!=='saitu.performance-profile-review.v1'||review.reviewerContextIds?.length!==2
    ||contexts.some(id=>typeof id!=='string'||!id)||new Set(contexts).size!==3||!Array.isArray(review.profiles)
    ||review.profiles.length!==expected.size||new Set(review.profiles.map(p=>p.profileId)).size!==expected.size
    ||new Set(review.profiles.map(p=>p.familyId)).size!==expected.size
    ||review.profiles.some(p=>p.outcome!=='approved'||!p.familyId||expected.get(p.profileId)!==p.semanticSha256))throw new Error('independent_review_does_not_bind_registered_profiles');
  return true;
}

/** Failed/missing runs remain in the denominator, with unbounded latency. */
export function summarizePerformance(registration,rows){
  const counts=validatePerformanceRegistration(registration),ids=new Set();
  for(const row of rows){if(ids.has(row.journeyId)||!registration.journeys.some(j=>j.journeyId===row.journeyId))throw new Error('duplicate_or_unregistered_measurement');ids.add(row.journeyId);}
  const byId=new Map(rows.map(row=>[row.journeyId,row]));
  const observed=registration.journeys.map(j=>{
    const row=byId.get(j.journeyId);if(!row)return {journeyId:j.journeyId,status:'not_run',firstDecisionMs:null,fullReportMs:null};
    const clock=row.browserClock?.clock;
    if(row.status==='observed'&&(!Number.isFinite(row.firstDecisionMs)||row.firstDecisionMs<0||!Number.isFinite(row.fullReportMs)||row.fullReportMs<row.firstDecisionMs
      ||!clock||clock.first!==row.firstDecisionMs||clock.full!==row.fullReportMs||clock.boundary?.requestPath!=='/api/competitions/recommend/normalize'
      ||clock.boundary.registeredClick!==true||clock.boundary.trustedClick!==true||!Number.isFinite(clock.start)
      ||!Number.isFinite(clock.responseAt)||clock.responseAt<clock.start||clock.first<clock.responseAt-clock.start))return {...row,status:'invalid_browser_clock'};
    if(registration.purpose==='formal'&&row.status==='observed'){
      try{
        const response=row.responses?.at(-1),actual=response?.report;
        const actualHash=canonicalHash(performanceProfileSemantics(actual?.profile));
        if(response.status!==200||response.responseVersion!=='competition-recommendation.v6'||row.outputSha256!==canonicalHash(actual)
          ||row.actualProfileSha256!==actualHash||actualHash!==canonicalHash(performanceProfileSemantics(j.profileInput,{registered:true}))
          ||row.flow!==j.flow||actual.profile.mode!==j.flow)throw new Error('profile_mismatch');
        return {...row,profileMatched:true,actualProfileSha256:actualHash};
      }catch{return {...row,status:'profile_mismatch'};}
    }
    return row;
  });
  const quantile=field=>{
    const values=observed.map(row=>row.status==='observed'&&Number.isFinite(row[field])&&row[field]>=0?row[field]:Infinity).sort((a,b)=>a-b);
    const value=values[Math.ceil(values.length*.95)-1];return Number.isFinite(value)?value:null;
  };
  return {schemaVersion:'saitu.browser-performance-summary.v1',...counts,actualMatchedProfiles:new Set(observed.filter(row=>row.status==='observed'&&row.profileMatched===true).map(row=>row.actualProfileSha256)).size,measured:rows.length,notRun:observed.filter(r=>r.status==='not_run').length,failed:observed.filter(r=>r.status!=='observed'&&r.status!=='not_run').length,fallbacks:observed.filter(r=>r.fallback===true).length,firstDecisionP95Ms:quantile('firstDecisionMs'),fullReportP95Ms:quantile('fullReportMs'),nullP95Means:'unbounded_due_to_failed_or_missing_measurements',latencyClock:registration.latencyClock,retries:0,allRegisteredRunsObserved:observed.every(r=>r.status==='observed'),acceptancePassed:false,limitation:'Browser timing alone cannot certify model quality, independent profile semantics, human timing or overall acceptance.'};
}

/** Real page and HTTP only. No route interception, response injection, or direct API-to-DOM substitute. */
export async function measureBrowserJourney({browser,baseURL,journey,timeoutMs,artifactDirectory,purpose='development'}){
  const context=await browser.newContext(journey.viewport==='mobile'?{viewport:{width:393,height:851},isMobile:true,hasTouch:true}:{viewport:{width:1440,height:1000}});
  const page=await context.newPage(),errors=[],requests=[],responses=[];
  page.setDefaultTimeout(timeoutMs);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  const pending=[];
  page.on('request',request=>{
    const pathname=new URL(request.url()).pathname,at=Date.now();
    if(pathname.startsWith('/api/ai/')||pathname==='/api/competitions/recommend/normalize')requests.push({path:pathname,method:request.method(),at});
    if(pathname==='/api/competitions/recommend/normalize'&&request.method()==='POST')pending.push(page.evaluate(({pathname,at})=>{
      const clock=window.__saituPerformance;if(clock.start!==null)return;
      const click=[...clock.clicks].reverse().find(click=>click.at<=at);
      if(!click||!click.registeredClick||!click.trustedClick){clock.boundaryError='normalization_not_bound_to_registered_confirmation';return;}
      clock.start=click.perf;
      clock.boundary={requestPath:pathname,requestAt:at,clickAt:click.at,registeredClick:click.registeredClick,trustedClick:click.trustedClick};
      dispatchEvent(new Event('saitu-performance-response'));
    },{pathname,at}).catch(()=>{}));
  });
  page.on('response',response=>{
    if(new URL(response.url()).pathname!=='/api/ai/competition-recommend')return;
    const task=(async()=>{try{const body=await response.json();responses.push({status:response.status(),at:Date.now(),requestId:response.headers()['x-request-id']??null,report:body.report??null,responseVersion:body.responseVersion??null});
      if(response.status()===200&&body.responseVersion==='competition-recommendation.v6'&&body.report)await page.evaluate(report=>{
        window.__saituPerformance.responseAt=performance.now();
        window.__saituPerformance.expected=report;dispatchEvent(new Event('saitu-performance-response'));
      },body.report);
    }catch{responses.push({status:response.status(),at:Date.now(),report:null});}})();pending.push(task);
  });
  const result={journeyId:journey.journeyId,profileId:journey.profileId,profileInputSha256:canonicalHash(journey.profileInput),flow:journey.flow,viewport:journey.viewport,startedAt:new Date().toISOString(),status:'error',firstDecisionMs:null,fullReportMs:null,fallback:null,requests,responses,errors};
  try{
    await page.addInitScript(()=>{
      window.__saituPerformance={start:null,responseAt:null,first:null,full:null,expected:null,clicks:[],armNextClick:false,boundary:null};
      document.addEventListener('click',event=>{
        const button=event.target?.closest?.('button');
        if(!button||!button.closest('[data-phase="summary"]')||button.textContent.trim()!=='同意，请乐乐开始匹配')return;
        const clock=window.__saituPerformance;
        clock.clicks.push({perf:performance.now(),at:Date.now(),registeredClick:clock.armNextClick,trustedClick:event.isTrusted});
        clock.armNextClick=false;if(clock.clicks.length>80)clock.clicks.shift();
      },true);
      const inspect=()=>{
        const clock=window.__saituPerformance;if(clock.start===null)return;
        const report=document.querySelector('[data-testid="decision-report-v6"]');
        const expected=clock.expected;if(!report||!expected)return;
        const visible=element=>{if(!element||getComputedStyle(element).visibility==='hidden'||getComputedStyle(element).display==='none')return false;const rect=element.getBoundingClientRect();return rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth;};
        const text=(root,value,requireVisible=false)=>typeof value==='string'&&value.trim().length>0&&[...root.querySelectorAll('p,h3')].some(element=>element.textContent.trim()===value.trim()&&(!requireVisible||visible(element)));
        const summary=report.querySelector('section');
        const summaryReady=summary&&text(summary,expected.summary.direction.text,true)&&text(summary,expected.summary.nextStep.text,true);
        const concreteReady=expected.recommendations.some(item=>text(report,item.name,true)&&text(report,item.reasons[0]?.text,true));
        if((summaryReady||concreteReady)&&clock.first===null)clock.first=performance.now()-clock.start;
        const section=report.querySelector('section[aria-label="完整竞赛建议"]');
        const cardsReady=section&&expected.recommendations.slice(0,5).every(item=>{
          const card=section.querySelector(`#decision-${item.rank}`);return card&&text(card,item.name)&&text(card,item.coreTask.text)&&text(card,item.currentRole.text)&&text(card,item.nextStep.text)&&item.reasons.every(reason=>text(card,reason.text));
        });
        const emptyReady=expected.recommendations.length>0||section&&text(section,expected.shortlistShortfallReason);
        const remainingReady=expected.recommendations.length<=5||section&&[...section.querySelectorAll('button')].some(button=>button.textContent.includes(`查看其余 ${expected.recommendations.length-5} 项`));
        if(clock.first!==null&&cardsReady&&emptyReady&&remainingReady&&report.querySelector('#decision-edit-field')&&clock.full===null){
          requestAnimationFrame(()=>requestAnimationFrame(()=>{if(clock.full===null)clock.full=performance.now()-clock.start;}));
        }
      };
      new MutationObserver(inspect).observe(document,{childList:true,subtree:true,attributes:true});
      addEventListener('scroll',inspect,{passive:true});
      addEventListener('saitu-performance-response',inspect);
    });
    await page.goto(new URL('/competitions/recommend',baseURL).href,{waitUntil:'domcontentloaded'});
    result.pageTitle=await page.title();
    for(const step of journey.steps){
      const target=page.locator(step.selector);
      if(step.startDecisionClock)await page.evaluate(()=>{
        const clock=window.__saituPerformance;
        if(clock.start!==null||clock.expected!==null||clock.boundaryError)throw new Error('decision_clock_marker_is_after_submission');
        clock.armNextClick=true;
      });
      if(step.action==='click')await target.click();
      else if(step.action==='check')await target.check();
      else if(step.action==='choose')await target.evaluate(element=>element.closest('label')?.click());
      else if(step.action==='fill')await target.fill(step.value);
      else if(step.action==='select')await target.selectOption(step.value);
      else if(step.action==='followups'){
        for(let turn=0;turn<6;turn++){
          await page.waitForFunction(()=>/^(results|followups|optional_followup|error)$/.test([...document.querySelectorAll('[data-phase]')].at(-1)?.getAttribute('data-phase')??''),null,{timeout:timeoutMs});
          const phase=await page.locator('[data-phase]').last().getAttribute('data-phase');
          if(phase==='results')break;
          if(phase==='error')throw new Error('product_error_during_followups');
          if(phase==='optional_followup'){await page.getByRole('button',{name:'直接查看推荐',exact:true}).click();continue;}
          const question=page.getByTestId('conversation-current-question'),questionText=await question.innerText();
          const answer=step.answers.find(answer=>questionText.includes(answer.questionContains));
          if(answer)await question.getByRole(answer.role??'radio',{name:answer.optionLabel,exact:true}).evaluate(element=>element.closest('label')?.click());
          else if(step.developmentFirstChoice)await question.locator('input[type="radio"],input[type="checkbox"]').first().evaluate(element=>element.closest('label')?.click());
          else throw new Error('unregistered_followup_question');
          await question.getByRole('button',{name:/确认(?:回答|理解)，继续/}).click();
        }
      }
      else await target.waitFor({state:'visible'});
    }
    await page.waitForFunction(()=>window.__saituPerformance.full!==null,null,{timeout:timeoutMs});
    const clock=await page.evaluate(()=>window.__saituPerformance);
    if(!clock.boundary||clock.boundaryError)throw new Error('confirmation_clock_boundary_not_observed');
    await Promise.all(pending);
    const response=responses.at(-1),report=response?.report;
    if(response?.status!==200||response.responseVersion!=='competition-recommendation.v6'||!report||errors.length)throw new Error('browser_report_or_console_check_failed');
    const actualProfile=performanceProfileSemantics(report.profile);result.actualProfile=actualProfile;result.actualProfileSha256=canonicalHash(actualProfile);
    result.profileMatched=purpose==='formal'&&result.actualProfileSha256===canonicalHash(performanceProfileSemantics(journey.profileInput,{registered:true}));
    if(purpose==='formal'&&(!result.profileMatched||report.profile.mode!==journey.flow))throw new Error('actual_confirmed_profile_or_flow_differs_from_registration');
    result.firstDecisionMs=clock.first;result.fullReportMs=clock.full;result.outputSha256=canonicalHash(report);result.fallback=report.fallback.used;
    result.method=report.trace.method;result.model=report.trace.model;result.profileRevision=report.profile.revision;
    result.horizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
    if(result.horizontalOverflow)throw new Error('horizontal_overflow');
    result.status='observed';
  }catch(error){result.error=error instanceof Error?error.message:'browser_measurement_failed';}
  finally{
    await Promise.all(pending);
    try{result.browserClock=await page.evaluate(()=>({clock:window.__saituPerformance,scrollY,viewportHeight:innerHeight,reportHeadingY:document.querySelector('[data-testid="decision-report-v6"] h2')?.getBoundingClientRect().top??null}));}catch{result.browserClockUnavailable=true;}
    // Signed state tokens are deliberately excluded; raw reports contain only the
    // preregistered synthetic student's facts and public competition evidence.
    if(artifactDirectory)try{await page.screenshot({path:`${artifactDirectory}/${journey.journeyId}.png`,fullPage:true});await page.screenshot({path:`${artifactDirectory}/${journey.journeyId}-viewport.png`,fullPage:false});}catch{result.screenshotMissing=true;}
    result.finishedAt=new Date().toISOString();await context.close();
  }
  return result;
}
