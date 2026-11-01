// логика на этапе 2 — уже здесь

/* ==========================================================
   FIT SMART — вся логика приложения
   - Калькулятор BMR / TDEE / целевых ккал / БЖУ + круговая диаграмма
   - Тренировки: добавление упражнений и итоговый тоннаж
   - Сон: длительность по времени засыпания и пробуждения
   - Питание: разбор CSV-выгрузки FatSecret («съел / цель / разница»)
   - Все данные сохраняются в localStorage
   ========================================================== */

(function () {
  'use strict';

  /* ================= Утилиты ================= */

  const $ = (id) => document.getElementById(id);

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));

  // Число: CEления «60» → «60», «1 234,5» → «1234,5»→1234.5
  const num = (v) => {
    const n = parseFloat(String(v).replace(',', '.').replace(/\s/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  let fmt = (n) => {
    n = Math.round(n * 100) / 100;
    return Number.isInteger(n) ? String(n) : String(n);
  };

  const KEYS = { profile: 'fit_profile', workout: 'fit_workout', sleep: 'fit_sleep' };

  const load = (key, dflt) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : dflt;
    } catch { return dflt; }
  };
  const store = (key, val) => {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* приватный режим и т.п. */ }
  };

  /* ================= 1. Калькулятор калорий и БЖУ ================= */

  const profileForm = $('profile-form');
  const resultsCard = $('results-card');
  const carbWarning = $('carb-warning');

  // Цели: множитель калорий и нормы граммов на кг веса
  const GOALS = {
    gain:     { kcalFactor: 1.15, proteinPerKg: 2.0, fatPerKg: 1.0 }, // набор массы
    cut:      { kcalFactor: 0.80, proteinPerKg: 2.4, fatPerKg: 0.9 }, // сушка
    maintain: { kcalFactor: 1.00, proteinPerKg: 1.8, fatPerKg: 1.0 }, // поддержание
  };

  let macroChart = null;
  let lastResult = (load(KEYS.profile, {}) || {}).result || null;

  function readProfile() {
    const age = num($('age').value);
    const weight = num($('weight').value);
    const height = num($('height').value);
    const gender = profileForm.elements.gender.value;
    const activity = parseFloat($('activity').value) || 1.2;
    const goal = $('goal').value;
    if (!(age >= 14 && age <= 90) || !(weight >= 30 && weight <= 300) || !(height >= 120 && height <= 250)) return null;
    return { gender, age, weight, height, activity, goal };
  }

  function calculate() {
    if (!profileForm.reportValidity()) return;
    const p = readProfile();
    if (!p) return;

    // Формула Миффлина — Сан Жеора
    const genderOffset = p.gender === 'male' ? 5 : -161;
    const bmr = Math.round(10 * p.weight + 6.25 * p.height - 5 * p.age + genderOffset);
    const tdee = Math.round(bmr * p.activity);

    const g = GOALS[p.goal] || GOALS.maintain;
    const target = Math.round(tdee * g.kcalFactor);

    // БЖУ: белки и жиры фиксированы нормой, углеводы — остаток калорий
    const protein = Math.round(g.proteinPerKg * p.weight);
    const fat = Math.round(g.fatPerKg * p.weight);
    let carbs = Math.round((target - protein * 4 - fat * 9) / 4);
    if (carbs < 0) carbs = 0;

    $('bmr').textContent = bmr;
    $('tdee').textContent = tdee;
    $('target-kcal').textContent = target;
    $('protein').textContent = protein;
    $('fat').textContent = fat;
    $('carb').textContent = carbs;

    resultsCard.classList.remove('hidden');
    carbWarning.classList.toggle('hidden', carbs >= 100);

    renderChart(protein, fat, carbs);
    lastResult = { target, protein, fat, carbs };
    store(KEYS.profile, { ...p, result: lastResult });

    resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- Круговая диаграмма БЖУ ---------- */

  function renderChart(protein, fat, carbs) {
    const labels = ['Белки', 'Углеводы', 'Жиры'];
    const colors = ['#ff6b00', '#a3e635', '#ffd43b'];
    const data = [protein, carbs, fat];

    // Chart.js, если загрузился с CDN
    if (typeof window.Chart === 'function') {
      if (!$('macroChart')) {
        document.querySelector('.chart-box').innerHTML =
          '<div class="chart-stage"><canvas id="macroChart"></canvas></div>';
      }
      if (macroChart) { macroChart.destroy(); macroChart = null; }
      macroChart = new window.Chart($('macroChart'), {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{
            data,
            backgroundColor: colors,
            borderColor: '#1e1e1e',
            borderWidth: 3,
            hoverOffset: 4,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '62%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: '#d9d9d9', boxWidth: 12, boxHeight: 12, padding: 10, font: { size: 11 } },
            },
          },
        },
      });
      return;
    }

    // Оффлайн-фолибэк: диаграмма на CSS (conic-gradient), без библиотек
    const shares = [protein * 4, carbs * 4, fat * 9]; // доли считаем по калориям
    const total = shares.reduce((s, v) => s + v, 0);
    if (total <= 0) return;

    if (macroChart) { try { macroChart.destroy(); } catch { /* браузер сам убил канвас */ } macroChart = null; }

    let acc = 0;
    const stops = shares.map((v, i) => {
      const from = (acc / total) * 100;
      acc += v;
      const to = (acc / total) * 100;
      return `${colors[i]} ${from}% ${to}%`;
    }).join(', ');

    const legend = labels
      .map((l, i) => `<span class="legend-item"><i class="dot" style="background:${colors[i]}"></i>${l}</span>`)
      .join('');

    const box = document.querySelector('.chart-box');
    box.innerHTML =
      `<div class="donut-stack">
        <div class="donut-css" style="background: conic-gradient(${stops})"><div class="donut-hole"></div></div>
        <div class="legend-row">${legend}</div>
      </div>`;
  }

  /* ================= 2. Тренировка и тоннаж ================= */

  const workoutForm = $('workout-form');
  const workoutBody = $('workout-body');
  const totalCell = $('total-tonnage');

  let workoutRows = load(KEYS.workout, []);
  if (!Array.isArray(workoutRows)) workoutRows = [];

  const tonnageOf = (r) => r.sets * r.reps * r.weight;

  function renderWorkout() {
    store(KEYS.workout, workoutRows);

    if (!workoutRows.length) {
      workoutBody.innerHTML = '<tr class="empty"><td colspan="6">Пока пусто — добавьте первое упражнение</td></tr>';
      totalCell.textContent = '0';
      return;
    }

    workoutBody.innerHTML = workoutRows.map((r, i) => `
      <tr>
        <td>${esc(r.exercise)}</td>
        <td class="num">${r.sets}</td>
        <td class="num">${r.reps}</td>
        <td class="num">${fmt(r.weight)}</td>
        <td class="num">${fmt(tonnageOf(r))}</td>
        <td class="num">
          <button type="button" class="del-btn" data-i="${i}" title="Убрать упражнение" aria-label="Убрать упражнение">×</button>
        </td>
      </tr>
    `).join('');

    const total = workoutRows.reduce((s, r) => s + tonnageOf(r), 0);
    totalCell.textContent = fmt(total);
  }

  $('add-exercise').addEventListener('click', () => {
    if (!workoutForm.reportValidity()) return;
    const row = {
      exercise: $('exercise').value,
      sets: parseInt($('sets').value, 10) || 0,
      reps: parseInt($('reps').value, 10) || 0,
      weight: num($('bar-weight').value),
    };
    if (!row.exercise || row.sets < 1 || row.reps < 1 || row.weight < 0) return;

    workoutRows.push(row);
    $('sets').value = '';
    $('reps').value = '';
    $('bar-weight').value = '';
    renderWorkout();
  });

  workoutBody.addEventListener('click', (e) => {
    const btn = e.target.closest('.del-btn');
    if (!btn) return;
    workoutRows.splice(parseInt(btn.dataset.i, 10), 1);
    renderWorkout();
  });

  /* ================= 3. Сон ================= */

  const sleepStart = $('sleep-start');
  const sleepEnd = $('sleep-end');
  const sleepDuration = $('sleep-duration');

  function updateSleep() {
    store(KEYS.sleep, { start: sleepStart.value, end: sleepEnd.value });

    if (!sleepStart.value || !sleepEnd.value) {
      sleepDuration.value = '';
      return;
    }

    const [h1, m1] = sleepStart.value.split(':').map(Number);
    const [h2, m2] = sleepEnd.value.split(':').map(Number);

    // Пробуждение позже полуночи → добавляем сутки
    let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (diff <= 0) diff += 24 * 60;

    sleepDuration.value = `${Math.floor(diff / 60)} ч ${diff % 60} мин`;
  }

  sleepStart.addEventListener('change', updateSleep);
  sleepEnd.addEventListener('change', updateSleep);

  /* ================= 4. Питание: CSV из FatSecret ================= */

  const csvInput = $('csv-file');
  const nutritionBox = $('nutrition-table');

  // Разбор одной строки CSV с учётом кавычек
  function splitCsv(line, delim) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === delim && !inQuotes) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function parseFatSecret(text) {
    const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2) return null;

    // Разделитель: обычно «,», русские выгрузки из Excel — «;»
    const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
    const header = splitCsv(lines[0], delim).map((h) => h.trim().toLowerCase());
    if (!header.length) return null;

    // Поиск нужных колонок по ключевым словам (русская и английская выгрузки)
    const findCol = (preds) => {
      for (const pred of preds) {
        const i = header.findIndex(pred);
        if (i !== -1) return i;
      }
      return -1;
    };

    const kcalI = findCol([h => /калор|ккал|энерг|calor|energy/.test(h)]);
    const proteinI = findCol([h => /белк|protein/.test(h)]);
    const carbsI = findCol([h => /углев|carb/.test(h)]);
    const fatI = findCol([
      h => /жир/.test(h) && !/насыщ|полиненасыщ|моно/.test(h),
      h => /\bfat\b/.test(h) && !/saturat|poly|mono|trans/.test(h),
      h => /жир|fat/.test(h),
    ]);
    const dateI = findCol([h => /^дата|^date/.test(h), h => /start day/.test(h), h => /\bday\b|\bдень\b/.test(h)]);

    if (kcalI === -1 && proteinI === -1 && carbsI === -1 && fatI === -1) return null;

    const sums = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    const days = new Set();
    let records = 0;

    for (let li = 1; li < lines.length; li++) {
      const cells = splitCsv(lines[li], delim);
      if (!cells.length) continue;
      records++;

      if (dateI !== -1 && cells[dateI]) days.add(cells[dateI].trim());

      if (kcalI !== -1) sums.kcal += num(cells[kcalI]);
      if (proteinI !== -1) sums.protein += num(cells[proteinI]);
      if (carbsI !== -1) sums.carbs += num(cells[carbsI]);
      if (fatI !== -1) sums.fat += num(cells[fatI]);
    }

    return {
      kcal: sums.kcal,
      protein: sums.protein,
      carbs: sums.carbs,
      fat: sums.fat,
      records,
      days: days.size,
      hasDate: dateI !== -1 && days.size > 0,
    };
  }

  function renderNutrition(r, filename) {
    // Если в файле есть даты — показываем среднее значение за день
    const divisor = r.hasDate && r.days > 0 ? r.days : 1;

    const rows = [
      { label: 'Калории, ккал', ate: r.kcal / divisor, goal: lastResult ? lastResult.target : null },
      { label: 'Белки, г', ate: r.protein / divisor, goal: lastResult ? lastResult.protein : null },
      { label: 'Жиры, г', ate: r.fat / divisor, goal: lastResult ? lastResult.fat : null },
      { label: 'Углеводы, г', ate: r.carbs / divisor, goal: lastResult ? lastResult.carbs : null },
    ];

    const head = '<tr><th>Показатель</th><th class="num">Съел</th><th class="num">Цель</th><th class="num">Разница</th></tr>';

    const body = rows
      .map((row) => {
        const diff = row.goal == null ? null : row.ate - row.goal;
        const cls = diff == null ? '' : diff > 0.5 ? 'diff-over' : diff < -0.5 ? 'diff-under' : '';
        const diffText = diff == null ? '—' : (diff > 0 ? '+' : diff < 0 ? '−' : '') + fmt(Math.abs(Math.round(diff * 10) / 10));
        return `<tr>
          <td>${row.label}</td>
          <td class="num">${fmt(Math.round(row.ate * 10) / 10)}</td>
          <td class="num">${row.goal == null ? '—' : fmt(row.goal)}</td>
          <td class="num ${cls}">${diffText}</td>
        </tr>`;
      })
      .join('');

    const note = `Файл: ${esc(filename)} • записей: ${r.records}` +
      (r.hasDate && r.days > 0 ? ` • дней: ${r.days} (показано среднее за день)` : '');

    nutritionBox.className = '';
    nutritionBox.innerHTML =
      `<div class="table-wrap nutrition"><table>${head}${body}</table></div><p class="hint">${note}</p>`;
  }

  function renderNutritionError(filename) {
    nutritionBox.className = 'table-placeholder';
    nutritionBox.textContent =
      `Не удалось разобрать «${filename}». Нужны стандартные колонки экспорта FatSecret (калории, белки, жиры, углеводы).`;
  }

  csvInput.addEventListener('change', () => {
    const file = csvInput.files && csvInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseFatSecret(reader.result);
      if (!parsed) renderNutritionError(file.name);
      else renderNutrition(parsed, file.name);
    };
    reader.onerror = () => renderNutritionError(file.name);
    reader.readAsText(file, 'utf-8');
  });

  /* ================= 5. Восстановление и запуск ================= */

  function restore() {
    // Сон
    const s = load(KEYS.sleep, {}) || {};
    if (s.start) sleepStart.value = s.start;
    if (s.end) sleepEnd.value = s.end;
    updateSleep();

    // Профиль — если считали раньше, восстанавливаем и сразу считаем
    const p = load(KEYS.profile, null);
    if (p && p.age != null) {
      if (p.gender === 'female') {
        const f = profileForm.querySelector('input[name="gender"][value="female"]');
        if (f) f.checked = true;
      }
      $('age').value = p.age;
      $('weight').value = p.weight;
      $('height').value = p.height;
      $('activity').value = p.activity;
      $('goal').value = p.goal;
      calculate();
    }

    renderWorkout();
  }

  $('calc-btn').addEventListener('click', calculate);

  restore();
})();

/* ========== Мини-таблица для чисел с дробями ========== */
