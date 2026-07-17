const fs = require("fs");
const path = require("path");
const vm = require("vm");

const htmlPath = path.join(process.cwd(), "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const inlineScripts = Array.from(html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/g));
const appScript = inlineScripts.at(-1)?.[1];
const errors = [];

if (!appScript) {
  errors.push("index.html のアプリ本体 script が見つかりません。");
} else {
  const topicSeedLine = appScript.match(/function topicSeed[^\n]+/);
  if (!topicSeedLine) {
    errors.push("topicSeed() が見つかりません。");
  } else if (topicSeedLine[0].includes("||") || topicSeedLine[0].includes("TOPICS[subject][0]")) {
    errors.push("topicSeed() にフォールバック生成が残っています。");
  }

  const defsEnd = appScript.indexOf("const STEMS=");
  if (defsEnd < 0) {
    errors.push("CATEGORY_DEFS の検証範囲を特定できません。");
  } else {
    try {
      const defsCtx = { console };
      vm.createContext(defsCtx);
      vm.runInContext(
        `${appScript.slice(0, defsEnd)}\nglobalThis.__defs={SUBJECTS,TOPICS,CATEGORY_DEFS};`,
        defsCtx
      );
      validateDefinitions(defsCtx.__defs, errors);
    } catch (error) {
      errors.push(`定義の読み込みに失敗しました: ${error.message}`);
    }
  }

  try {
    const runtimeCtx = makeRuntimeContext();
    vm.createContext(runtimeCtx);
    vm.runInContext(
      `${appScript.replace(/init\(\);\s*$/, "")}\nglobalThis.__generated=GENERATED_QUESTIONS;globalThis.__subjects=SUBJECTS;globalThis.__cats=CATEGORY_DEFS;`,
      runtimeCtx
    );
    validateGenerated(runtimeCtx.__generated, runtimeCtx.__subjects, runtimeCtx.__cats, errors);
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

function validateDefinitions(defs, errors) {
  const { SUBJECTS, TOPICS, CATEGORY_DEFS } = defs;
  for (const subject of SUBJECTS) {
    const seeds = TOPICS[subject.id];
    const cats = CATEGORY_DEFS[subject.id];
    if (!Array.isArray(seeds)) {
      errors.push(`${subject.name}: TOPICS が未定義です。`);
      continue;
    }
    if (!Array.isArray(cats)) {
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

    const quotaSum = cats.reduce((sum, cat) => sum + cat.quota, 0);
    if (quotaSum !== 100) errors.push(`${subject.name}: ジャンル配分が100問ではありません: ${quotaSum}`);

    for (const cat of cats) {
      for (const topic of cat.topics) {
        if (!topicNames.has(topic)) {
          errors.push(`${subject.name}/${cat.name}: 未定義トピックです: ${topic}`);
        }
      }
    }
  }
}

function validateGenerated(generated, subjects, categoryDefs, errors) {
  if (!Array.isArray(generated)) {
    errors.push("GENERATED_QUESTIONS が配列ではありません。");
    return;
  }
  if (generated.length !== 700) errors.push(`通常問題が700問ではありません: ${generated.length}`);

  for (const subject of subjects) {
    const subjectQuestions = generated.filter(q => q.subject === subject.id);
    if (subjectQuestions.length !== 100) {
      errors.push(`${subject.name}: 生成問題が100問ではありません: ${subjectQuestions.length}`);
    }

    for (const cat of categoryDefs[subject.id]) {
      const catQuestions = subjectQuestions.filter(q => q.category === cat.id);
      if (catQuestions.length !== cat.quota) {
        errors.push(`${subject.name}/${cat.name}: 配分どおりに生成されていません: ${catQuestions.length}/${cat.quota}`);
      }
      for (const q of catQuestions) {
        if (!cat.topics.includes(q.topic)) {
          errors.push(`${subject.name}/${cat.name}: カテゴリ外トピックが生成されました: ${q.topic}`);
        }
      }
    }
  }
}

function makeRuntimeContext() {
  const noop = () => {};
  const element = () => ({
    classList: { add: noop, remove: noop, toggle: noop },
    style: {},
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
    }
  };
}
