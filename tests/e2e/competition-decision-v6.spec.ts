import { expect, test, type Page } from "@playwright/test";

// Browser plugin not available. Use the repository's Playwright runner.
test.use({actionTimeout:15000,launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}});

async function select(page:Page,name:string,role:"radio"|"checkbox"="radio") {
  await page.getByTestId("conversation-current-question").getByRole(role,{name,exact:true}).evaluate(element=>element.closest("label")?.click());
}
async function next(page:Page) {await page.getByTestId("conversation-current-question").getByRole("button",{name:"回答好了，继续",exact:true}).click();}
async function skip(page:Page) {await page.getByTestId("conversation-current-question").getByRole("button",{name:"暂不确定，跳过这题",exact:true}).click();}
async function finishFollowups(page:Page) {
  for(let index=0;index<6;index++) {
    await expect.poll(async()=>page.locator('[data-phase]').last().getAttribute("data-phase"),{timeout:90000}).toMatch(/results|followups|optional_followup|error/);
    const phase=await page.locator('[data-phase]').last().getAttribute("data-phase");
    if(phase==="results")return;
    if(phase==="error")throw new Error(await page.locator('[data-phase="error"]').innerText());
    if(phase==="optional_followup")await page.getByRole("button",{name:"直接查看推荐",exact:true}).click();
    else {
      const question=page.getByTestId("conversation-current-question");
      await question.locator('input[type="radio"],input[type="checkbox"]').first().evaluate(element=>element.closest("label")?.click());
      await question.getByRole("button",{name:/确认(?:回答|理解)，继续/}).click();
    }
  }
  await expect(page.getByTestId("decision-report-v6")).toBeVisible();
}
async function enterExperience(page:Page) {
  await select(page,"本科大一");await next(page);
  await skip(page);await skip(page);await skip(page);
  await expect(page.getByTestId("conversation-current-question")).toContainText("除了比赛，你能想起一件自己参与过的事吗");
}

test("v6 quick novice can reach confirmation using task interests and a personal budget",async({page},testInfo)=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto("/competitions/recommend");
  await select(page,"先发现自己愿意长期做的方向");
  await select(page,"确认，先按这个方向比较");await next(page);
  await enterExperience(page);
  await select(page,"暂时想不起或还没有");
  await expect(page.getByTestId("conversation-current-question")).toContainText("只说明兴趣，不会当作已有能力");
  await page.getByTestId("conversation-current-question").getByRole("combobox").first().selectOption("try");
  await next(page);await skip(page);
  await select(page,"每周 5–10 小时");await select(page,"先体验 1–2 周");await next(page);
  await select(page,"101–500 元");await page.getByRole("spinbutton",{name:/预算上限/}).fill("300");await select(page,"我个人的总预算");await next(page);
  await expect(page.locator('[data-phase="summary"]')).toBeVisible();
  await expect(page.getByTestId("conversation-transcript")).toContainText("暂时没有或想不起具体经历，不代表没有能力");
  await expect(page.getByTestId("conversation-transcript")).toContainText("个人预算");
  await expect(page.getByRole("button",{name:"同意，请乐乐开始匹配",exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await page.screenshot({path:testInfo.outputPath("v6-novice-confirmation.png"),fullPage:true});
  let recommendStarted=0;page.on("request",request=>{if(request.url().endsWith("/api/ai/competition-recommend")&&request.method()==="POST")recommendStarted=Date.now();});
  const responsePromise=page.waitForResponse(response=>response.url().endsWith("/api/ai/competition-recommend")&&response.request().method()==="POST",{timeout:120000});
  await page.locator('[data-phase="summary"]').getByRole("checkbox").check();
  await page.getByRole("button",{name:"同意，请乐乐开始匹配",exact:true}).click();
  await finishFollowups(page);
  const response=await responsePromise;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON().reportVersion).toBe("competition-recommendation.v6");
  const payload=await response.json();
  expect(payload.responseVersion).toBe("competition-recommendation.v6");
  expect(payload.report.profile.facts.some((fact:{field:string;value:unknown})=>fact.field==="budget.maximumYuan"&&fact.value===300)).toBe(true);
  const result=page.getByTestId("decision-report-v6");
  await expect(result).toBeVisible();
  await expect(result.getByRole("heading",{name:"先找到值得你投入的方向",exact:true})).toBeInViewport();
  const visibleMs=Date.now()-recommendStarted;
  await testInfo.attach("a1-decision-visible-timing",{body:JSON.stringify({mode:"A1 rules, mocked questionnaire, real browser",recommendRequestToVisibleMs:visibleMs,modelCallCount:payload.report.trace.callCount}),contentType:"application/json"});
  console.info(JSON.stringify({event:"a1_browser_decision_visible",project:testInfo.project.name,elapsedMs:visibleMs,modelCallCount:payload.report.trace.callCount}));
  expect(payload.report.trace.callCount).toBe(0);expect(visibleMs).toBeLessThan(15000);
  expect(payload.report.recommendations.length).toBeGreaterThan(0);
  await expect(result.locator('article[id^="decision-"]')).toHaveCount(Math.min(5,payload.report.recommendations.length));
  if(payload.report.recommendations.length>5){await result.getByRole("button",{name:/查看其余/}).click();await expect(result.locator('article[id^="decision-"]')).toHaveCount(payload.report.recommendations.length);}
  if(payload.report.recommendations.length>=2){await result.getByText("比较两到三项，看清怎么取舍",{exact:true}).click();await expect(result.getByRole("table")).toBeVisible();}
  await result.locator('article[id^="decision-"]').first().locator("summary").first().click();
  await page.screenshot({path:testInfo.outputPath("v6-report.png"),fullPage:true});
  await result.getByRole("combobox",{name:"想修改目标、经历或投入条件？",exact:true}).selectOption("8");
  await result.getByRole("button",{name:"修改后重新匹配",exact:true}).click();
  await select(page,"暂不自费");await next(page);
  const revisedPromise=page.waitForResponse(response=>response.url().endsWith("/api/ai/competition-recommend")&&response.request().method()==="POST",{timeout:120000});
  await page.locator('[data-phase="summary"]').getByRole("checkbox").check();
  await page.getByRole("button",{name:"同意，请乐乐开始匹配",exact:true}).click();
  await finishFollowups(page);
  const revised=await (await revisedPromise).json();
  expect(revised.report.profile.revision).not.toBe(payload.report.profile.revision);
  await expect(result.getByRole("heading",{name:"你修改后，哪些判断变了",exact:true})).toBeVisible();
  await expect(result).toContainText("不愿发生支出");
  const chat=page.getByTestId("decision-chat");
  await expect(chat).toBeVisible();
  await chat.getByRole("textbox",{name:"想追问或更正什么？"}).fill("比较这两项的区别");
  await chat.getByRole("button",{name:"发送",exact:true}).click();
  await expect(chat).toContainText("先比较任务");
  await chat.getByRole("textbox",{name:"想追问或更正什么？"}).fill("我的个人预算改为100元");
  await chat.getByRole("button",{name:"发送",exact:true}).click();
  await expect(chat.getByTestId("decision-update-proposal")).toContainText("个人自付上限：100元");
  const chatRecompute=page.waitForResponse(response=>response.url().endsWith("/api/ai/competition-chat")&&response.request().postDataJSON()?.action.type==="confirm_update");
  await chat.getByRole("button",{name:"确认更正并重新匹配",exact:true}).click();
  const chatUpdated=await (await chatRecompute).json();
  expect(chatUpdated.kind).toBe("report_updated");
  expect(chatUpdated.report.profile.revision).not.toBe(revised.report.profile.revision);
  expect(chatUpdated.report.profile.facts.some((fact:{field:string;value:unknown})=>fact.field==="budget.maximumYuan"&&fact.value===100)).toBe(true);
  await expect(chat).toContainText("已按你确认的更正重新计算");
  await chat.getByRole("textbox",{name:"想追问或更正什么？"}).fill("我今年19岁");
  await chat.getByRole("button",{name:"发送",exact:true}).click();
  await expect(chat.getByTestId("decision-update-proposal")).toBeVisible();
  const ageConfirmation=page.waitForResponse(response=>response.url().endsWith("/api/ai/competition-chat")&&response.request().postDataJSON()?.action.type==="confirm_update");
  await chat.getByRole("button",{name:"确认更正并重新匹配",exact:true}).click();
  const ageResult=await(await ageConfirmation).json();
  expect(ageResult.report.profile.facts.find((fact:{field:string})=>fact.field==="eligibility.age").value).toBe(19);
  await result.getByRole("combobox",{name:"想修改目标、经历或投入条件？",exact:true}).selectOption("8");
  await result.getByRole("button",{name:"修改后重新匹配",exact:true}).click();
  await select(page,"101–500 元");await page.getByRole("spinbutton",{name:/预算上限/}).fill("200");await next(page);
  const finalEdit=page.waitForResponse(response=>response.url().endsWith("/api/ai/competition-recommend")&&response.request().method()==="POST",{timeout:120000});
  await page.locator('[data-phase="summary"]').getByRole("checkbox").check();
  await page.getByRole("button",{name:"同意，请乐乐开始匹配",exact:true}).click();
  await finishFollowups(page);
  const finalResponse=await finalEdit, finalBody=await finalResponse.json();
  expect(finalResponse.request().postDataJSON().decisionEdit.changedFields).toEqual(expect.arrayContaining(["budget","budget.maximumYuan"]));
  expect(finalBody.report.profile.profileId).toBe(ageResult.report.profile.profileId);
  expect(finalBody.report.profile.facts.find((fact:{field:string})=>fact.field==="eligibility.age")).toEqual(ageResult.report.profile.facts.find((fact:{field:string})=>fact.field==="eligibility.age"));
  expect(finalBody.report.profile.facts.find((fact:{field:string})=>fact.field==="budget.maximumYuan").value).toBe(200);
  await page.screenshot({path:testInfo.outputPath("v6-report-chat-confirmed.png"),fullPage:true});
  await result.getByRole("checkbox",{name:"选择收藏这一项",exact:true}).first().check();
  await result.getByRole("button",{name:"收藏所选 1 项",exact:true}).click();
  await expect(result.getByRole("status").last()).toContainText("已收藏所选 1 项");
  await result.getByRole("link",{name:"打开我的竞赛",exact:true}).click();
  await expect(page.getByTestId("saved-decision-list").locator("li")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("v6 goal conflicts require a decision and each experience keeps its own contribution",async({page},testInfo)=>{
  await page.goto("/competitions/recommend");await page.getByRole("button",{name:"想聊得更细",exact:true}).click();
  await select(page,"把想法做成作品","checkbox");await select(page,"了解本校认定、综测与评奖机会","checkbox");
  await expect(page.getByTestId("conversation-current-question").getByRole("button",{name:"请选择或填写",exact:true})).toBeDisabled();
  await select(page,"把想法做成作品");await select(page,"暂不决定，先看不同方向的取舍");await next(page);
  await enterExperience(page);await select(page,"有，我想补充一段具体经历");
  const question=page.getByTestId("conversation-current-question");
  await question.getByRole("textbox",{name:"具体做了什么？",exact:true}).first().fill("协助整理社团问卷");
  await question.getByRole("combobox",{name:"其中你本人负责哪种程度的工作？",exact:true}).first().selectOption("assisted");
  await question.getByRole("combobox",{name:"这件事最后到哪一步？",exact:true}).first().selectOption("draft");
  await question.getByRole("checkbox",{name:/以上准确描述了我的任务和本人贡献/}).first().check();
  await question.getByRole("button",{name:"补充第二段经历",exact:true}).click();
  await question.getByRole("textbox",{name:"具体做了什么？",exact:true}).nth(1).fill("独立编写文件整理小工具");
  await question.getByRole("combobox",{name:"其中你本人负责哪种程度的工作？",exact:true}).nth(1).selectOption("independent");
  await question.getByRole("combobox",{name:"这件事最后到哪一步？",exact:true}).nth(1).selectOption("delivered");
  await question.getByRole("checkbox",{name:/以上准确描述了我的任务和本人贡献/}).nth(1).check();
  await question.getByRole("textbox",{name:"具体做了什么？",exact:true}).first().fill("协助核对社团问卷中的缺失项");
  await expect(question.getByRole("checkbox",{name:/以上准确描述了我的任务和本人贡献/}).first()).not.toBeChecked();
  await expect(question.getByRole("checkbox",{name:/以上准确描述了我的任务和本人贡献/}).nth(1)).toBeChecked();
  await question.getByRole("checkbox",{name:/以上准确描述了我的任务和本人贡献/}).first().check();
  await page.screenshot({path:testInfo.outputPath("v6-independent-experiences.png"),fullPage:true});
  await next(page);
  const transcript=page.getByTestId("conversation-transcript");
  await expect(transcript).toContainText("尚未决定首要目标");
  await expect(transcript).toContainText("协助完成其中一部分");
  await expect(transcript).toContainText("独立完成具体任务");
});

test("v6 selected competition survives navigation and can be removed from saved page",async({page})=>{
  const claim={text:"先用整理资料任务验证兴趣",basis:"suggestion",studentFactIds:[],competitionFactIds:[],conditions:[]};
  const recommendation={rank:1,itemId:"e2e-decision",seriesId:"china-college-computer-design",name:"主动收藏示例",trackLabel:"资料与数据表达",edition:"往届任务参考",contentTier:"L1",eligibilityStatus:"unknown",eligibilityNotes:["资格待核实"],registration:{status:"historical",note:"不代表当前可以报名"},preparation:"explore",coreTask:claim,reasons:[claim],currentRole:claim,gaps:[claim],values:[{dimension:"skill",claim}],difficulty:["entry","completion","award"].map(stage=>({stage,claim})),opportunityCost:claim,nextStep:claim,checkpoint:"体验后再决定",sources:[],evidenceFacts:[]};
  await page.addInitScript(store=>localStorage.setItem("saitu.savedDecisionChoices.v6",JSON.stringify(store)),{schemaVersion:"saitu.savedDecisionChoices.v6",items:[{savedAt:"2026-11-05T08:00:00.000Z",reportId:"report-e2e",catalogVersion:"test",profileRevision:"test",recommendation}]});
  await page.goto("/competitions/saved");
  await expect(page.getByText("已保存 1 项",{exact:true})).toBeVisible();
  await expect(page.getByTestId("saved-decision-list")).toContainText("主动收藏示例");
  await page.getByText("查看保存时的任务、收益与下一步",{exact:true}).click();
  await expect(page.getByText("以上是收藏时的建议，报名状态不会自动变成最新。",{exact:false})).toBeVisible();
  await page.getByRole("button",{name:"移除主动收藏示例",exact:true}).click();
  await expect(page.getByTestId("saved-competitions-empty")).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("saitu.savedDecisionChoices.v6")??"{}").items)).toEqual([]);
});

test("v6 competition detail explains tasks, value, difficulty and scoped sources",async({page},testInfo)=>{
  await page.goto("/competitions/china-college-computer-design");
  const guide=page.getByTestId("decision-catalog-detail");
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("heading",{name:"难度要分三个阶段看",exact:true})).toBeVisible();
  await expect(guide.getByRole("heading",{name:"“含金量”具体体现在哪里",exact:true})).toBeVisible();
  await expect(guide).toContainText("先用一个小任务体验，不急着报名");
  await guide.getByText("继续核对资格、参与方式与评价要求",{exact:true}).click();
  const evidence=guide.locator("details").filter({has:page.locator('summary')}).first();
  await evidence.locator("summary").first().click();
  expect(await guide.getByRole("link").count()).toBeGreaterThan(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await page.screenshot({path:testInfo.outputPath("v6-competition-detail.png"),fullPage:true});
});
