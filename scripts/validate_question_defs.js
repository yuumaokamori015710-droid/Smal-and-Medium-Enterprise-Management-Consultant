const fs = require("fs");
const path = require("path");
const vm = require("vm");

const htmlPath = path.join(process.cwd(), "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const pastQuestionsScript = fs.readFileSync(path.join(process.cwd(), "data", "past_questions.js"), "utf8");
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
      `${pastQuestionsScript}\n${appScript.replace(/init\(\);\s*$/, "")}\nglobalThis.__generated=GENERATED_QUESTIONS;globalThis.__extracted=EXTRACTED_QUESTIONS;globalThis.__questions=QUESTIONS;globalThis.__subjects=SUBJECTS;globalThis.__cats=CATEGORY_DEFS;globalThis.__subjectTarget=SUBJECT_QUIZ_TARGET;globalThis.__all=ALL_PRACTICE_QUESTIONS;`,
      runtimeCtx
    );
    validateGenerated(
      runtimeCtx.__generated,
      runtimeCtx.__extracted,
      runtimeCtx.__questions,
      runtimeCtx.__subjects,
      runtimeCtx.__cats,
      runtimeCtx.__subjectTarget,
      runtimeCtx.__all,
      runtimeCtx.pickSet,
      errors
    );
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
    if (quotaSum !== 100) errors.push(`${subject.name}: ジャンル配分比率が100%ではありません: ${quotaSum}`);

    for (const cat of cats) {
      for (const topic of cat.topics) {
        if (!topicNames.has(topic)) {
          errors.push(`${subject.name}/${cat.name}: 未定義トピックです: ${topic}`);
        }
      }
    }
  }
}

function validateGenerated(generated, extracted, questions, subjects, categoryDefs, subjectTarget, allPractice, pickSet, errors) {
  if (!Array.isArray(generated)) {
    errors.push("GENERATED_QUESTIONS が配列ではありません。");
    return;
  }
  if (!Array.isArray(extracted)) errors.push("EXTRACTED_QUESTIONS が配列ではありません。");
  if (!Array.isArray(questions)) errors.push("QUESTIONS が配列ではありません。");
  if (!Array.isArray(allPractice)) errors.push("ALL_PRACTICE_QUESTIONS が配列ではありません。");
  if (!Number.isInteger(subjectTarget) || subjectTarget < 1) errors.push(`SUBJECT_QUIZ_TARGET が不正です: ${subjectTarget}`);

  const expectedTotal = subjects.length * subjectTarget;
  if (questions.length !== expectedTotal) errors.push(`クイズ総問題数が科目200問仕様と一致しません: ${questions.length}/${expectedTotal}`);
  if (generated.length !== expectedTotal) errors.push(`生成クイズ問題数が科目200問仕様と一致しません: ${generated.length}/${expectedTotal}`);
  if (questions.some(q => q.sourceType === "past")) errors.push("QUESTIONS に過去問抽出問題が混入しています。");
  if (extracted.some(q => q.sourceType !== "past")) errors.push("EXTRACTED_QUESTIONS に過去問以外の sourceType が含まれています。");
  if (new Set(questions.map(q => q.id)).size !== questions.length) errors.push("QUESTIONS に ID 重複があります。");
  if (new Set(allPractice.map(q => q.id)).size !== allPractice.length) errors.push("ALL_PRACTICE_QUESTIONS に ID 重複があります。");
  if (allPractice.length !== questions.length + extracted.length) errors.push("ALL_PRACTICE_QUESTIONS がクイズ+過去問抽出の合計と一致しません。");

  for (const subject of subjects) {
    const subjectQuestions = questions.filter(q => q.subject === subject.id);
    if (subjectQuestions.length !== subjectTarget) {
      errors.push(`${subject.name}: クイズ問題数が200問ではありません: ${subjectQuestions.length}/${subjectTarget}`);
    }
    const uniquePoints = new Set(subjectQuestions.map(q => q.point)).size;
    if (uniquePoints < Math.min(100, Math.floor(subjectQuestions.length / 2))) {
      errors.push(`${subject.name}: 問題ごとのポイント文の種類が少なすぎます: ${uniquePoints}/${subjectQuestions.length}`);
    }
    validateSampleMix(subject.name, subjectQuestions, 10, Number.POSITIVE_INFINITY, pickSet, errors);

    for (const cat of categoryDefs[subject.id]) {
      const expectedCatTotal = Math.round(subjectTarget * cat.quota / 100);
      const catQuestions = subjectQuestions.filter(q => q.category === cat.id);
      if (catQuestions.length !== expectedCatTotal) {
        errors.push(`${subject.name}/${cat.name}: 配分どおりの問題数ではありません: ${catQuestions.length}/${expectedCatTotal}`);
      }
      for (const q of catQuestions) {
        if (q.sourceType !== "quiz") {
          errors.push(`${subject.name}/${cat.name}: クイズ以外の sourceType が含まれています: ${q.id}`);
        }
        if (!["normal", "reverse"].includes(q.mode)) {
          errors.push(`${subject.name}/${cat.name}: mode が normal/reverse ではありません: ${q.id}`);
        }
        if (typeof q.point !== "string" || q.point.length < 20) {
          errors.push(`${subject.name}/${cat.name}: 問題ごとのポイントが不足しています: ${q.id}`);
        }
        if (!Array.isArray(q.choices) || q.choices.length !== 4) {
          errors.push(`${subject.name}/${cat.name}: 選択肢が4つではありません: ${q.id}`);
        } else {
          if (new Set(q.choices).size !== q.choices.length) {
            errors.push(`${subject.name}/${cat.name}: 選択肢に重複があります: ${q.id}`);
          }
          if (!q.choices.includes(q.answer)) {
            errors.push(`${subject.name}/${cat.name}: 正解が選択肢に含まれていません: ${q.id}`);
          }
        }
        if (!cat.topics.includes(q.topic)) {
          errors.push(`${subject.name}/${cat.name}: カテゴリ外トピックが生成されました: ${q.topic}`);
        }
      }
      const normal = catQuestions.filter(q => q.mode === "normal").length;
      const reverse = catQuestions.filter(q => q.mode === "reverse").length;
      if (Math.abs(normal - reverse) > 1) {
        errors.push(`${subject.name}/${cat.name}: 通常問題と逆引き問題の比率が偏っています: normal=${normal}, reverse=${reverse}`);
      }
      validateSampleMix(`${subject.name}/${cat.name}`, catQuestions, 10, Math.max(0, 10 - cat.topics.length), pickSet, errors);
    }
  }
}

function validateSampleMix(label, questions, limit, allowedTopicDupes, pickSet, errors) {
  if (typeof pickSet !== "function" || questions.length === 0) return;
  const sampleSize = Math.min(limit, questions.length);
  const sample = pickSet(questions, sampleSize, "random");
  if (sample.length !== sampleSize) {
    errors.push(`${label}: 10問サンプルの抽出数が不足しています: ${sample.length}/${sampleSize}`);
    return;
  }
  if (sampleSize >= 2) {
    const modes = new Set(sample.map(q => q.mode));
    if (questions.some(q => q.mode === "normal") && questions.some(q => q.mode === "reverse") && modes.size < 2) {
      errors.push(`${label}: 10問サンプルに通常問題と逆引き問題が混在していません。`);
    }
  }
  const topicDupes = sample.length - new Set(sample.map(q => q.topic)).size;
  if (topicDupes > allowedTopicDupes) {
    errors.push(`${label}: 10問サンプル内の論点重複が多すぎます: ${topicDupes}`);
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
