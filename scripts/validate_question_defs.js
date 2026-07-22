const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = process.cwd();
const htmlPath = path.join(root, "index.html");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const html = fs.readFileSync(htmlPath, "utf8");
const readme = read("README.md");
const pastQuestionsScript = read(path.join("data", "past_questions.js"));
const inlineScripts = Array.from(html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/g));
const appScript = inlineScripts.at(-1)?.[1];
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
      `${pastQuestionsScript}\n${appScript.replace(/init\(\);\s*$/, "")}\nglobalThis.__generated=GENERATED_QUESTIONS;globalThis.__extracted=EXTRACTED_QUESTIONS;globalThis.__questions=QUESTIONS;globalThis.__subjects=SUBJECTS;globalThis.__cats=CATEGORY_DEFS;globalThis.__all=ALL_PRACTICE_QUESTIONS;globalThis.__pdf=PDF_ITEMS;`,
      runtimeCtx
    );
    runtimeCtx.__dashboardCards = runtimeCtx.subjectProgressHtml();
    validateGenerated(runtimeCtx, errors);
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
    'data-tab="home">ダッシュボード',
    'data-tab="pdf">PDF',
    'data-tab="history">学習履歴',
    'data-tab="settings"'
  ];
  for (const tab of requiredTabs) {
    if (!html.includes(tab)) errors.push(`上部タブが仕様と一致しません: ${tab}`);
  }
  const nav = html.match(/<nav class="tabs"[\s\S]*?<\/nav>/)?.[0] || "";
  const navTabIds = [...nav.matchAll(/data-tab="([^"]+)"/g)].map(match => match[1]);
  if (JSON.stringify(navTabIds) !== JSON.stringify(["home", "pdf", "history", "settings"])) {
    errors.push(`上部タブの構成が4項目ではありません: ${navTabIds.join(", ")}`);
  }
  if (/<button[^>]+id="themeBtn"/.test(html)) errors.push("独立したテーマ切替ボタンが残っています。");

  const requiredSections = [
    'id="subjectProgressList"',
    'id="wrongFiveList"',
    'id="genreProgress"',
    'id="pdf"',
    'id="settings"',
    'id="pastQuiz"'
  ];
  for (const section of requiredSections) {
    if (!html.includes(section)) errors.push(`必要な画面または領域が見つかりません: ${section}`);
  }

  if (!html.includes("過去に間違えた問題5選")) errors.push("ダッシュボードの誤答5選が見つかりません。");
  const home = html.match(/<section id="home"[\s\S]*?<\/section>/)?.[0] || "";
  if ((home.match(/過去に間違えた問題5選/g) || []).length !== 1) errors.push("ダッシュボードの誤答5選が重複しています。");
  if (/(dailyStartBtn|practiceHomeBtn|mockHomeBtn|pastHomeBtn|dashboardPdfBtn|dashboardPdfBox|recentHistoryList)/.test(home)) {
    errors.push("ダッシュボードに不要なショートカットまたはカードが残っています。");
  }
  if (!html.includes('onclick="openSubjectGenre')) errors.push("科目カードからジャンル選択への導線が見つかりません。");
  if (html.includes(">復習対象の問題<")) errors.push("削除対象の復習対象カードが残っています。");
  if (!html.includes('<option value="fresh" selected>初見ランダム')) errors.push("出題方法のデフォルトが初見ランダムではありません。");
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
  if (!appScript.includes("function wrongFiveQuestions")) errors.push("誤答5選の抽出関数が見つかりません。");
  if (!appScript.includes("PDF_ITEMS")) errors.push("PDFデータモデルが見つかりません。");
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
  const questions = ctx.__questions;
  const subjects = ctx.__subjects;
  const categoryDefs = ctx.__cats;
  const allPractice = ctx.__all;
  const pdfItems = ctx.__pdf;
  const dashboardCards = ctx.__dashboardCards;

  if (!Array.isArray(generated) || !generated.length) errors.push("GENERATED_QUESTIONS が空です。");
  if (!Array.isArray(extracted)) errors.push("EXTRACTED_QUESTIONS が配列ではありません。");
  if (!Array.isArray(questions)) errors.push("QUESTIONS が配列ではありません。");
  if (!Array.isArray(allPractice)) errors.push("ALL_PRACTICE_QUESTIONS が配列ではありません。");
  if (!Array.isArray(pdfItems)) errors.push("PDF_ITEMS が配列ではありません。");
  if (typeof dashboardCards !== "string") {
    errors.push("ダッシュボード進捗カードを生成できません。");
  } else {
    const subjectCards = dashboardCards.match(/class="subject-progress-card"/g) || [];
    if (subjectCards.length !== 7) errors.push(`科目進捗カードが7枚ではありません: ${subjectCards.length}`);
    if (!dashboardCards.includes('class="overall-progress-card"')) errors.push("全体進捗カードがありません。");
    if (!dashboardCards.includes("難問 0 / 0問")) errors.push("難問のクリア数/総数表示がありません。");
    if (dashboardCards.includes("登録問題数") || dashboardCards.includes("解答済み")) errors.push("進捗カードに問題数の内訳が残っています。");
  }
  if (questions.some(q => q.sourceType === "past")) errors.push("QUESTIONS に過去問抽出問題が混入しています。");
  if (extracted.some(q => q.sourceType !== "past")) errors.push("EXTRACTED_QUESTIONS に過去問以外の sourceType が含まれています。");
  if (new Set(questions.map(q => q.id)).size !== questions.length) errors.push("QUESTIONS に ID 重複があります。");
  if (new Set(allPractice.map(q => q.id)).size !== allPractice.length) errors.push("ALL_PRACTICE_QUESTIONS に ID 重複があります。");
  if (allPractice.length !== questions.length + extracted.length) errors.push("ALL_PRACTICE_QUESTIONS がクイズ+過去問抽出の合計と一致しません。");

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
  }

  for (const subject of subjects) {
    const subjectQuestions = questions.filter(q => q.subject === subject.id);
    if (!subjectQuestions.length) errors.push(`${subject.name}: 登録問題がありません。`);
    const definedCategoryIds = new Set(categoryDefs[subject.id].map(c => c.id));
    for (const q of subjectQuestions) {
      if (!definedCategoryIds.has(q.category)) errors.push(`${subject.name}: 未定義ジャンルの問題があります: ${q.category}`);
    }
  }

  for (const item of pdfItems) {
    for (const field of ["id", "name", "type", "subject", "genre", "year", "examStage", "url"]) {
      if (!item[field]) errors.push(`PDF_ITEMS の ${field} が不足しています: ${JSON.stringify(item)}`);
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
