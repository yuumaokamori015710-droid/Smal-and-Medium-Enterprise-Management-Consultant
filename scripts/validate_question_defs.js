const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = process.cwd();
const htmlPath = path.join(root, "index.html");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const html = fs.readFileSync(htmlPath, "utf8");
const readme = read("README.md");
const pastQuestionsScript = read(path.join("data", "past_questions.js"));
const pastQuestionCategoriesScript = read(path.join("data", "past_question_categories.js"));
const studyGuidesScript = read(path.join("data", "study_guides.js"));
const studyQuestionsScript = read(path.join("data", "study_questions.js"));
const inlineScripts = Array.from(html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/g));
const appScript = inlineScripts.map(match => match[1]).find(script => script.includes("const SUBJECTS="));
const errors = [];

validateShell(html, readme, errors);

if (!appScript) {
  errors.push("index.html のアプリ本体 script が見つかりません。");
} else {
  validateScriptText(appScript, errors);
  const defsEnd = appScript.indexOf("const STEMS=");
  if (defsEnd < 0) {
    errors.push("CATEGORY_DEFS の検証範囲を特定できません。");
  } else {
    try {
      const defsCtx = { console };
      vm.createContext(defsCtx);
      vm.runInContext(`${appScript.slice(0, defsEnd)}\nglobalThis.__defs={SUBJECTS,TOPICS,CATEGORY_DEFS};`, defsCtx);
      validateDefinitions(defsCtx.__defs, errors);
    } catch (error) {
      errors.push(`定義の読み込みに失敗しました: ${error.message}`);
    }
  }

  try {
    const runtimeCtx = makeRuntimeContext();
    vm.createContext(runtimeCtx);
    vm.runInContext(
      `${pastQuestionsScript}\n${pastQuestionCategoriesScript}\n${studyGuidesScript}\n${studyQuestionsScript}\n${appScript.replace(/init\(\);\s*$/, "")}\nglobalThis.__generated=GENERATED_QUESTIONS;globalThis.__extracted=EXTRACTED_QUESTIONS;globalThis.__study=STUDY_QUESTIONS;globalThis.__questions=QUESTIONS;globalThis.__subjects=SUBJECTS;globalThis.__cats=CATEGORY_DEFS;globalThis.__all=ALL_PRACTICE_QUESTIONS;globalThis.__pdf=PDF_ITEMS;globalThis.__mockSpecs=MOCK_SPECS;globalThis.__pastCategoryMap=window.PAST_QUESTION_CATEGORIES;globalThis.__quizCollection=quizCollection;globalThis.__quizQuestionType=quizQuestionType;globalThis.__activeQuizPool=activeQuizPool;globalThis.__filterQuestionType=filterQuestionType;globalThis.__mockAttempts=mockAttempts;globalThis.__mockAttemptSummary=mockAttemptSummary;globalThis.__setMockHistory=history=>{store.mockHistory=history};`,
      runtimeCtx
    );
    runtimeCtx.__dashboardCards = runtimeCtx.subjectProgressHtml();
    runtimeCtx.__overallProgress = runtimeCtx.overallProgressHtml();
    validateGenerated(runtimeCtx, errors);
    validatePastQuestionCategories(runtimeCtx, errors);
  } catch (error) {
    errors.push(`問題生成に失敗しました: ${error.message}`);
  }
}

if (errors.length) {
  console.error("Question definition validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Question definition validation passed.");

function validateShell(html, readme, errors) {
  const requiredTabs = [
    ["home", "ホーム"],
    ["quiz", "問題"],
    ["pastQuiz", "模試"],
    ["pdf", "PDF"],
    ["settings", "設定"]
  ];
  const nav = html.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0] || "";
  for (const [id, label] of requiredTabs) {
    if (!nav.includes(`data-tab="${id}"`) || !nav.includes(`>${label}<`)) {
      errors.push(`下部ナビが仕様と一致しません: ${id} / ${label}`);
    }
  }
  const navTabIds = [...nav.matchAll(/data-tab="([^"]+)"/g)].map(match => match[1]);
  if (JSON.stringify(navTabIds) !== JSON.stringify(["home", "quiz", "pastQuiz", "pdf", "settings"])) {
    errors.push(`下部ナビの構成が6項目ではありません: ${navTabIds.join(", ")}`);
  }
  if (/<button[^>]+id="themeBtn"/.test(html)) errors.push("独立したテーマ切替ボタンが残っています。");

  const requiredSections = [
    'id="subjectProgressList"',
    'id="dailyStartBtn"',
    'id="genreProgress"',
    'id="pdf"',
    'id="settings"',
    'id="pastQuiz"'
  ];
  for (const section of requiredSections) {
    if (!html.includes(section)) errors.push(`必要な画面または領域が見つかりません: ${section}`);
  }

  if (!html.includes("間違えた問題")) errors.push("ダッシュボードの間違えた問題スタートが見つかりません。");
  if (!html.includes('src="data/study_guides.js"')) errors.push("解説・用語ガイドが読み込まれていません。");
  if (!html.includes('src="data/study_questions.js"')) errors.push("質問ベース問題集データが読み込まれていません。");
  for (const token of ['id="quizCollection"', 'id="quizQuestionType"', 'id="openPointsBtn"', 'id="points"']) {
    if (!html.includes(token)) errors.push(`質問ベース問題集のUIが不足しています: ${token}`);
  }
  if (!html.includes("中小企業診断士合格のポイント")) errors.push("合格のポイント画面が見つかりません。");
  const home = html.match(/<section id="home"[\s\S]*?<\/section>/)?.[0] || "";
  if (!home.includes('id="dailyStartBtn"')) errors.push("間違えた問題のスタートボタンが見つかりません。");
  if (!home.includes('id="wrongQuestionTotal"')) errors.push("間違えた問題の総数表示が見つかりません。");
  if (home.includes('id="wrongFiveList"')) errors.push("間違えた問題の一覧が残っています。");
  if (home.includes("過去に間違えた問題5選")) errors.push("旧名称の誤答5選が残っています。");
  if (home.indexOf('id="dailyStartBtn"') > home.indexOf('id="overallProgressPanel"')) errors.push("間違えた問題のスタートが全体進捗より下にあります。");
  if (/(practiceHomeBtn|mockHomeBtn|pastHomeBtn|dashboardPdfBtn|dashboardPdfBox|recentHistoryList)/.test(home)) {
    errors.push("ダッシュボードに不要なショートカットまたはカードが残っています。");
  }
  if (!html.includes('onclick="openSubjectGenre')) errors.push("科目カードからジャンル選択への導線が見つかりません。");
  if (html.includes(">復習対象の問題<")) errors.push("削除対象の復習対象カードが残っています。");
  if (!html.includes('<option value="fresh" selected>初見ランダム')) errors.push("出題方法のデフォルトが初見ランダムではありません。");
  if (!html.includes("const MOCK_SPECS=")) errors.push("科目別の模試設定がありません。");
  if (!html.includes('id="pastQuizSubject"')) errors.push("模試の科目選択がありません。");
  if (/(pastQuizYear|pastQuizLimit|pastQuizOrder|pastPracticeMode)/.test(html)) errors.push("模試に不要な選択項目が残っています。");
  const fixedTargetToken = ["SUBJECT", "QUIZ", "TARGET"].join("_");
  if (html.includes(fixedTargetToken) || readme.includes(["1", "400", "問"].join(",")) || readme.includes(["各科目", "200", "問"].join(""))) {
    errors.push("固定問題数仕様の残骸があります。");
  }
  const fixedCount = "150";
  if ([`過去問${fixedCount}問`, `全${fixedCount}問`, `${fixedCount}問模試`, `${fixedCount}問中`].some(text => (html + readme).includes(text))) {
    errors.push("一律固定問題数の表示が残っています。");
  }
}

function validateScriptText(appScript, errors) {
  const fixedTargetToken = ["SUBJECT", "QUIZ", "TARGET"].join("_");
  if (appScript.includes(fixedTargetToken)) errors.push("固定件数ターゲットが残っています。");
  const topicSeedLine = appScript.match(/function topicSeed[^\n]+/);
  if (!topicSeedLine) {
    errors.push("topicSeed() が見つかりません。");
  } else if (topicSeedLine[0].includes("||") || topicSeedLine[0].includes("TOPICS[subject][0]")) {
    errors.push("topicSeed() にフォールバック生成が残っています。");
  }
  if (!appScript.includes("function filterByOrder")) errors.push("出題モードの抽出関数が見つかりません。");
  if (!appScript.includes("function wrongCandidates")) errors.push("間違えた問題の抽出関数が見つかりません。");
  if (!appScript.includes("function wrongFiveSet")) errors.push("間違えた問題の5問抽出関数が見つかりません。");
  if (!appScript.includes("ALL_PRACTICE_QUESTIONS.filter")) errors.push("過去問を含む間違えた問題の抽出が見つかりません。");
  if (!appScript.includes("PDF_ITEMS")) errors.push("PDFデータモデルが見つかりません。");
  if (!appScript.includes("function explanationText")) errors.push("正解理由を組み立てる関数が見つかりません。");
  if (!appScript.includes("function glossaryText")) errors.push("用語解説を組み立てる関数が見つかりません。");
  if (!appScript.includes("function pastExplanationText")) errors.push("模試の過去問解説を組み立てる関数が見つかりません。");
  if (!appScript.includes("PAST_ANSWER_NOTES")) errors.push("模試の問題別解説データが見つかりません。");
  if (!appScript.includes("data-resume-subject") || !appScript.includes("function sessionSlot")) errors.push("科目別の続きから保存が実装されていません。");
  if (!appScript.includes("function activeQuizPool")) errors.push("問題セットを切り替える関数が見つかりません。");
  if (!appScript.includes("function filterQuestionType")) errors.push("問題形式フィルタが見つかりません。");
  if (!appScript.includes("function choiceExplanationHtml")) errors.push("選択肢別の不正解理由表示が見つかりません。");
  if (appScript.includes("guidedAnswerSupplementHtml") || appScript.includes("解く順番") || appScript.includes("よくあるひっかけ")) errors.push("ジャンル共通の一般論が解説表示に残っています。");
}

function validateDefinitions(defs, errors) {
  const { SUBJECTS, TOPICS, CATEGORY_DEFS } = defs;
  const expectedSubjects = [
    "経済学・経済政策",
    "財務・会計",
    "企業経営理論",
    "運営管理",
    "経営法務",
    "経営情報システム",
    "中小企業経営・中小企業政策"
  ];
  const actualSubjects = SUBJECTS.map(s => s.name);
  if (JSON.stringify(actualSubjects) !== JSON.stringify(expectedSubjects)) {
    errors.push(`7科目の表示が仕様と一致しません: ${actualSubjects.join(", ")}`);
  }

  for (const subject of SUBJECTS) {
    const seeds = TOPICS[subject.id];
    const cats = CATEGORY_DEFS[subject.id];
    if (!Array.isArray(seeds) || !seeds.length) {
      errors.push(`${subject.name}: TOPICS が未定義です。`);
      continue;
    }
    if (!Array.isArray(cats) || !cats.length) {
      errors.push(`${subject.name}: CATEGORY_DEFS が未定義です。`);
      continue;
    }

    const topicNames = new Set();
    for (const seed of seeds) {
      if (!Array.isArray(seed) || seed.length < 4) {
        errors.push(`${subject.name}: 不正な TOPICS 定義があります。`);
        continue;
      }
      const [topic, answer, wrongChoices] = seed;
      if (topicNames.has(topic)) errors.push(`${subject.name}: TOPICS に重複があります: ${topic}`);
      topicNames.add(topic);
      if (!answer || !Array.isArray(wrongChoices) || wrongChoices.length < 3) {
        errors.push(`${subject.name}/${topic}: 正答または誤答選択肢が不足しています。`);
      }
      if (wrongChoices.includes(answer)) {
        errors.push(`${subject.name}/${topic}: 正答が誤答選択肢にも含まれています。`);
      }
    }

    for (const cat of cats) {
      for (const topic of cat.topics) {
        if (!topicNames.has(topic)) errors.push(`${subject.name}/${cat.name}: 未定義トピックです: ${topic}`);
      }
    }
  }
}

function validateGenerated(ctx, errors) {
  const generated = ctx.__generated;
  const extracted = ctx.__extracted;
  const study = ctx.__study;
  const questions = ctx.__questions;
  const subjects = ctx.__subjects;
  const categoryDefs = ctx.__cats;
  const allPractice = ctx.__all;
  const pdfItems = ctx.__pdf;
  const mockSpecs = ctx.__mockSpecs;
  const dashboardCards = ctx.__dashboardCards;
  const overallProgress = ctx.__overallProgress;

  if (!Array.isArray(generated) || !generated.length) errors.push("GENERATED_QUESTIONS が空です。");
  if (!Array.isArray(extracted)) errors.push("EXTRACTED_QUESTIONS が配列ではありません。");
  if (!Array.isArray(study) || !study.length) errors.push("STUDY_QUESTIONS が空です。");
  if (!Array.isArray(questions)) errors.push("QUESTIONS が配列ではありません。");
  if (!Array.isArray(allPractice)) errors.push("ALL_PRACTICE_QUESTIONS が配列ではありません。");
  if (!Array.isArray(pdfItems)) errors.push("PDF_ITEMS が配列ではありません。");
  if (!mockSpecs || typeof mockSpecs !== "object") errors.push("MOCK_SPECS が読み込めません。");
  if (!ctx.window.STUDY_GUIDES || typeof ctx.window.STUDY_GUIDES !== "object") {
    errors.push("解説・用語ガイドが読み込めません。");
  }
  if (typeof dashboardCards !== "string") {
    errors.push("ダッシュボード進捗カードを生成できません。");
  } else {
    const subjectCards = dashboardCards.match(/class="subject-progress-card(?:\s|")/g) || [];
    if (subjectCards.length !== 7) errors.push(`科目進捗カードが7枚ではありません: ${subjectCards.length}`);
    if (dashboardCards.includes("難問") || dashboardCards.includes("登録問題数")) errors.push("科目進捗カードに不要な情報が残っています。");
    if (!dashboardCards.includes("回答済み 0 / ")) errors.push("科目進捗カードに回答済み数がありません。");
    if (!dashboardCards.includes('class="subject-progress-bar"')) errors.push("科目進捗カードに進捗バーがありません。");
  }
  if (typeof overallProgress !== "string") {
    errors.push("全体進捗カードを生成できません。");
  } else {
    if (!overallProgress.includes('class="overall-progress-card"') || !overallProgress.includes('class="ring compact-ring"')) errors.push("円グラフ付きの全体進捗カードがありません。");
    if (!overallProgress.includes("回答済み 0 / ")) errors.push("全体進捗に回答済み数がありません。");
  }
  if (questions.some(q => q.sourceType === "past")) errors.push("QUESTIONS に過去問抽出問題が混入しています。");
  if (extracted.some(q => q.sourceType !== "past")) errors.push("EXTRACTED_QUESTIONS に過去問以外の sourceType が含まれています。");
  if (new Set(questions.map(q => q.id)).size !== questions.length) errors.push("QUESTIONS に ID 重複があります。");
  if (new Set(allPractice.map(q => q.id)).size !== allPractice.length) errors.push("ALL_PRACTICE_QUESTIONS に ID 重複があります。");
  if (allPractice.length !== questions.length + study.length + extracted.length) errors.push("ALL_PRACTICE_QUESTIONS がクイズ+質問ベース問題集+過去問抽出の合計と一致しません。");

  const requiredStudyFields = ['id', 'subject', 'category', 'questionType', 'question', 'correctAnswer', 'shortExplanation', 'detailedExplanation', 'examPoint', 'difficulty', 'tags', 'choiceExplanations'];
  const requiredTypes = ['term', 'true_false', 'comparison', 'calculation', 'causal_reasoning'];
  const allowedTypes = new Set([...requiredTypes, 'multiple_choice']);
  const studyIds = new Set();
  const studySubjectIds = new Set();
  const studyTypes = new Set();
  let reviewRequiredCount = 0;
  for (const q of study) {
    for (const field of requiredStudyFields) if (q[field] === undefined || q[field] === null || q[field] === '') errors.push(`質問ベース問題集の ${field} が不足しています: ${q.id || 'IDなし'}`);
    if (studyIds.has(q.id)) errors.push(`質問ベース問題集にID重複があります: ${q.id}`);
    studyIds.add(q.id);studySubjectIds.add(q.subject);studyTypes.add(q.questionType);
    if (q.sourceType !== 'study') errors.push(`質問ベース問題集の sourceType が不正です: ${q.id}`);
    if (!allowedTypes.has(q.questionType)) errors.push(`質問ベース問題集の問題形式が不正です: ${q.id}`);
    const choiceCountIsValid = q.questionType === 'true_false' ? q.choices?.length === 2 : q.choices?.length === 4;
    if (!Array.isArray(q.choices) || !choiceCountIsValid || new Set(q.choices).size !== q.choices.length || !q.choices.includes(q.answer)) errors.push(`質問ベース問題集の選択肢または正答が不正です: ${q.id}`);
    for (const choice of (q.choices || [])) if (choice !== q.answer && !q.choiceExplanations?.[choice]) errors.push(`質問ベース問題集の不正解理由が不足しています: ${q.id}`);
    if (!Number.isInteger(q.difficulty) || q.difficulty < 1 || q.difficulty > 3) errors.push(`質問ベース問題集の難易度が不正です: ${q.id}`);
    if (!Array.isArray(q.tags) || !q.tags.length) errors.push(`質問ベース問題集のタグが不足しています: ${q.id}`);
    if (/。。|！！|？？/.test(q.detailedExplanation || '')) errors.push(`質問ベース問題集の詳しい解説に句読点の重複があります: ${q.id}`);
    if (q.needsReview) reviewRequiredCount++;
  }
  if (study.length < 120) errors.push(`質問ベース問題集が不足しています: ${study.length}問`);
  if (studySubjectIds.size !== subjects.length || subjects.some(subject => !studySubjectIds.has(subject.id))) errors.push("質問ベース問題集が7科目をカバーしていません。");
  for (const type of requiredTypes) if (!studyTypes.has(type)) errors.push(`質問ベース問題集に ${type} 形式がありません。`);
  if (reviewRequiredCount < 3) errors.push("法改正・年度確認が必要な問題に needsReview が不足しています。");
  for (const subject of subjects) {
    const definedCategoryIds = new Set(categoryDefs[subject.id].map(category => category.id));
    for (const q of study.filter(question => question.subject === subject.id)) {
      if (!definedCategoryIds.has(q.category)) errors.push(`${subject.name}: 質問ベース問題集に未定義ジャンルがあります: ${q.category}`);
    }
  }
  if (ctx.__quizCollection && ctx.__activeQuizPool && ctx.__filterQuestionType) {
    ctx.__quizCollection.value = 'study';
    const selectedPool = ctx.__activeQuizPool();
    if (selectedPool.length !== study.length || selectedPool.some(question => question.sourceType !== 'study')) errors.push("質問ベース問題集のセット切替が正しく動作しません。");
    ctx.__quizQuestionType.value = 'calculation';
    const calculationPool = ctx.__filterQuestionType(selectedPool);
    if (!calculationPool.length || calculationPool.some(question => question.questionType !== 'calculation')) errors.push("質問ベース問題集の問題形式フィルタが正しく動作しません。");
  }

  const normalizedPastQuestions = new Set();
  for (const q of extracted) {
    const normalized = String(q.question || "").normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "");
    if (!normalized) errors.push(`過去問の問題文が空です: ${q.id}`);
    if (normalizedPastQuestions.has(normalized)) errors.push(`過去問に正規化後の重複があります: ${q.id}`);
    normalizedPastQuestions.add(normalized);
    if (!Array.isArray(q.choices) || q.choices.length < 4 || !q.choices.includes(q.answer)) {
      errors.push(`過去問の選択肢または正答が不正です: ${q.id}`);
    }
    if (!q.sourcePdf || !q.answerPdf) errors.push(`過去問の出典PDFが不足しています: ${q.id}`);
    const explanation = ctx.explanationText(q);
    if (explanation.includes("公式PDF") || explanation.includes("問題文に示された条件と選択肢の記述を照合")) {
      errors.push(`過去問に定型の模試解説が残っています: ${q.id}`);
    }
    const glossary = ctx.glossaryText(q);
    if (glossary && !glossary.includes("：")) errors.push(`過去問の用語解説の形式が不正です: ${q.id}`);
  }

  const gdpPastQuestion = extracted.find(question => question.id === 'past-R07-economics-04');
  if (!gdpPastQuestion || !ctx.explanationText(gdpPastQuestion).includes('輸出−輸入')) {
    errors.push("模試のGDP問題に個別の正解根拠が設定されていません。");
  }

  if (mockSpecs && typeof mockSpecs === "object") {
    const expectedMockSpecs = {
      economics: [25, 60], finance: [25, 60], strategy: [40, 90], operations: [40, 90],
      law: [25, 60], it: [25, 60], policy: [40, 90]
    };
    for (const subject of subjects) {
      const spec = mockSpecs[subject.id];
      if (!spec || !Number.isInteger(spec.questions) || !Number.isInteger(spec.minutes)) {
        errors.push(`${subject.name}: 模試設定が不正です。`);
        continue;
      }
      const [questions, minutes] = expectedMockSpecs[subject.id] || [];
      if (spec.questions !== questions || spec.minutes !== minutes) {
        errors.push(`${subject.name}: 本試験形式の問題数または時間が一致しません。`);
      }
      const available = extracted.filter(q => q.subject === subject.id).length;
      if (available < spec.questions) {
        errors.push(`${subject.name}: 模試の必要問題数 ${spec.questions} 問に対し、過去問が ${available} 問です。`);
      }
    }
  }

  if (typeof ctx.__mockAttempts !== "function" || typeof ctx.__mockAttemptSummary !== "function" || typeof ctx.__setMockHistory !== "function") {
    errors.push("模試の回数別成績を扱う関数が不足しています。");
  } else {
    ctx.__setMockHistory([
      { subject: "economics", ok: 16, total: 25, rate: 64, finishedAt: 200 },
      { subject: "economics", ok: 12, total: 25, rate: 48, finishedAt: 100 }
    ]);
    const attempts = ctx.__mockAttempts("economics");
    const summary = ctx.__mockAttemptSummary("economics");
    if (attempts.length !== 2 || attempts[0].attempt !== 1 || attempts[1].attempt !== 2 || !summary.includes("1回目 48%") || !summary.includes("2回目 64%")) {
      errors.push("模試の1回目・2回目の正答率表示が正しくありません。");
    }
  }

  const fingerprints = new Set();
  const topicModeKeys = new Set();
  for (const q of questions) {
    const fp = ctx.questionFingerprint(q);
    if (fingerprints.has(fp)) errors.push(`実質重複問題があります: ${q.id}`);
    fingerprints.add(fp);
    const topicKey = `${q.subject}|${String(q.topic).trim().toLowerCase()}|${q.mode}`;
    if (topicModeKeys.has(topicKey)) errors.push(`同一論点・同一出題方向の重複があります: ${topicKey}`);
    topicModeKeys.add(topicKey);
    if (!["normal", "reverse"].includes(q.mode)) errors.push(`mode が normal/reverse ではありません: ${q.id}`);
    if (!q.point || q.point.length < 45 || !q.point.includes("試験") || !q.point.includes("ひっかけ")) {
      errors.push(`試験向けポイントが不足しています: ${q.id}`);
    }
    if (!Array.isArray(q.choices) || q.choices.length !== 4) {
      errors.push(`選択肢が4つではありません: ${q.id}`);
    } else if (new Set(q.choices).size !== q.choices.length) {
      errors.push(`選択肢に重複があります: ${q.id}`);
    } else if (!q.choices.includes(q.answer)) {
      errors.push(`正解が選択肢に含まれていません: ${q.id}`);
    }
    for (const choice of (q.choices || [])) if (choice !== q.answer && !q.choiceExplanations?.[choice]) errors.push(`クイズの不正解理由が不足しています: ${q.id}`);
  }

  for (const subject of subjects) {
    const subjectQuestions = questions.filter(q => q.subject === subject.id);
    if (!subjectQuestions.length) errors.push(`${subject.name}: 登録問題がありません。`);
    const definedCategoryIds = new Set(categoryDefs[subject.id].map(c => c.id));
    for (const q of subjectQuestions) {
      if (!definedCategoryIds.has(q.category)) errors.push(`${subject.name}: 未定義ジャンルの問題があります: ${q.category}`);
    }
  }

  for (const q of [...study, ...questions]) {
    const selectedWrongChoice = q.choices?.find(choice => choice !== q.answer);
    const expectedReason = q.choiceExplanations?.[selectedWrongChoice];
    const rendered = ctx.choiceExplanationHtml?.(q, selectedWrongChoice) || '';
    if (!expectedReason || !rendered.includes(expectedReason)) {
      errors.push(`選択した不正解肢の理由を表示できません: ${q.id}`);
    }
  }

  for (const item of pdfItems) {
    for (const field of ["id", "name", "type", "subject", "genre", "year", "examStage", "url"]) {
      if (!item[field]) errors.push(`PDF_ITEMS の ${field} が不足しています: ${JSON.stringify(item)}`);
    }
  }

  if (allPractice.length >= 3 && typeof ctx.wrongCandidates === "function" && typeof ctx.wrongFiveSet === "function") {
    const [recentWrong, olderWrong, dueOnly] = allPractice;
    Object.assign(ctx.rec(recentWrong.id), { miss: 1, lastWrongAt: 200 });
    Object.assign(ctx.rec(olderWrong.id), { miss: 2, lastWrongAt: 100 });
    Object.assign(ctx.rec(dueOnly.id), { seen: true, dueAt: 0 });
    const wrongIds = ctx.wrongCandidates().map(question => question.id);
    const pickedIds = ctx.wrongFiveSet().map(question => question.id);
    if (wrongIds.length !== 2 || wrongIds.includes(dueOnly.id)) {
      errors.push("間違えた問題の総数に、誤答していない復習対象が混入しています。");
    }
    if (JSON.stringify(pickedIds) !== JSON.stringify([recentWrong.id, olderWrong.id])) {
      errors.push("間違えた問題の5問出題が、最終誤答日の新しい順になっていません。");
    }
  }
}

function validatePastQuestionCategories(ctx, errors) {
  const pastQuestions = ctx.window.PAST_QUIZ_QUESTIONS || [];
  const categoryMap = ctx.__pastCategoryMap;
  const categoryDefs = ctx.__cats;
  const extracted = ctx.__extracted;

  if (!categoryMap || typeof categoryMap !== "object") {
    errors.push("過去問ジャンル分類表が読み込めません。");
    return;
  }
  if (Object.keys(categoryMap).length !== pastQuestions.length) {
    errors.push(`過去問ジャンル分類表の件数が一致しません: ${Object.keys(categoryMap).length}/${pastQuestions.length}`);
  }

  for (const question of pastQuestions) {
    const categoryId = categoryMap[question.id];
    const category = (categoryDefs[question.subject] || []).find(item => item.id === categoryId);
    if (!category) errors.push(`過去問のジャンル分類が不正です: ${question.id} / ${categoryId || "未分類"}`);
  }
  for (const question of extracted) {
    if (question.category === "past-extracted" || question.categoryName === "過去問抽出") {
      errors.push(`過去問抽出の仮ジャンルが残っています: ${question.id}`);
    }
  }
}

function makeRuntimeContext() {
  const noop = () => {};
  const element = () => ({
    classList: { add: noop, remove: noop, toggle: noop },
    style: { setProperty: noop },
    dataset: {},
    options: [],
    selectedIndex: 0,
    value: "",
    disabled: false,
    innerHTML: "",
    textContent: "",
    querySelector: () => element(),
    querySelectorAll: () => [],
    appendChild: noop,
    addEventListener: noop
  });
  return {
    console,
    window: { PAST_QUIZ_QUESTIONS: [] },
    navigator: {},
    localStorage: { getItem: () => null, setItem: noop },
    matchMedia: () => ({ matches: true, addEventListener: noop }),
    document: {
      documentElement: { dataset: {} },
      getElementById: () => element(),
      createElement: () => element(),
      querySelectorAll: () => []
    },
    setInterval: noop,
    setTimeout: noop,
    Date
  };
}
