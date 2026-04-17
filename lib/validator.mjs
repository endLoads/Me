// Валидация рецепта v1.0
// Возвращает { valid, errors[], warnings[], data }

import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from './recipe-schema.json' with { type: 'json' };

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats.default ? addFormats.default(ajv) : addFormats(ajv);
const structuralValidate = ajv.compile(schema);

export function semanticValidate(data) {
  const warnings = [];

  // 8. КБЖУ через массу ингредиентов (учитываем loss_ratio)
  let totalGrams = 0;
  let hasIngredientGroups = false;
  for (const section of data.sections) {
    if (section.type === 'ingredient_group') { hasIngredientGroups = true; continue; }
    for (const ing of (section.ingredients || [])) {
      if (typeof ing.amount_g === 'number') {
        const loss = typeof ing.loss_ratio === 'number' ? ing.loss_ratio : 0;
        totalGrams += ing.amount_g * (1 - loss);
      }
    }
  }
  if (totalGrams > 0) {
    const kidRatio = data.kbju_kid ? data.kbju_kid.portion_g : data.kbju.portion_g * 0.4;
    const expected = data.servings.adult * data.kbju.portion_g + data.servings.kid * kidRatio;
    const lower = totalGrams * 0.80;
    const upper = totalGrams * 1.05;
    if (expected < lower || expected > upper) {
      warnings.push({
        code: 'kbju_mass_mismatch',
        path: '/kbju',
        message: `Масса сырья ${totalGrams.toFixed(0)} г, ожидаемый выход ${expected.toFixed(0)} г. Допустимо ${lower.toFixed(0)}–${upper.toFixed(0)} г.`
      });
    }
  }

  // 9. Детская безопасность
  if (data.for_whom.includes('Дети 12+ мес.') || data.for_whom.includes('Вся семья')) {
    const safetyKeywords = /безопасн|удуш|давит|мягк|нарез|температур|крупн|мелк|кусок|раздавить|форм|проверить/i;
    const mistakesText = (data.mistakes || []).map(m => `${m.symptom} ${m.cause} ${m.fix}`).join(' ');
    const tipsText = (data.tips || []).join(' ');
    if (!safetyKeywords.test(mistakesText) && !safetyKeywords.test(tipsText)) {
      warnings.push({ code: 'missing_kid_safety', path: '/mistakes', message: 'Рецепт для детей — нет пункта безопасности.' });
    }
  }

  // 10. Термощуп — placement в note
  if (data.params?.internal_temp) {
    const note = data.params.internal_temp.note || '';
    if (!/вставить|вставл|вотк|мерить|поместить|центр|толстое место|горизонтально/i.test(note)) {
      warnings.push({ code: 'thermometer_placement_unclear', path: '/params/internal_temp/note', message: 'Не описано куда вставлять щуп.' });
    }
  }

  // 11. Замены для критичных
  const criticalCount = data.sections.reduce((n, s) =>
    n + (s.ingredients || []).filter(i => i.critical).length, 0);
  if (criticalCount > 0 && (!data.substitutions || data.substitutions.length === 0)) {
    warnings.push({ code: 'no_substitutions_for_critical', path: '/substitutions', message: `${criticalCount} критичных ингредиентов — нет замен.` });
  }

  // 12. «Вся семья» без kbju_kid и упоминания детей в size_note
  if (data.for_whom.includes('Вся семья') && !data.kbju_kid) {
    const sn = data.serving?.size_note || '';
    if (!/дет|ребёнк|мес\.|год/i.test(sn)) {
      warnings.push({ code: 'family_recipe_no_kid_info', path: '/kbju_kid', message: 'Семейный рецепт — нет детской информации.' });
    }
  }

  return warnings;
}

export function validate(data) {
  const structOk = structuralValidate(data);
  const errors = structOk ? [] : structuralValidate.errors.map(e => ({
    code: 'schema_violation',
    path: e.instancePath || '/',
    message: `${e.message}${e.params ? ' · ' + JSON.stringify(e.params) : ''}`
  }));
  const warnings = structOk ? semanticValidate(data) : [];
  return { valid: structOk, errors, warnings, data };
}
