/* 화면 캡처용 스텁. Electron 없이 렌더러를 띄운다 —
   사용자의 화면을 뺏지 않고 라이트/다크·크기별로 찍기 위해서다.
   실제 빌드는 건드리지 않는다: out/renderer 를 /tmp 로 복사한 사본에만 넣는다. */
(function () {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const today = new Date();
  const day = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
  const at = (n, hh, mm) => `${day(n)}T${hh}:${mm}:00`;

  const Q = new URLSearchParams(location.search);
  const AI_LOCAL = Q.get('ai') === 'local';
  // 테마와 언어는 localStorage 에서 온다. ?theme=light&lang=en 으로 갈아끼운다.
  if (Q.get('theme')) localStorage.setItem('ticktick-theme', Q.get('theme'));
  if (Q.get('lang')) localStorage.setItem('ticktick-language', Q.get('lang'));
  const KO = (Q.get('lang') || 'ko') === 'ko';
  const L = (ko, en) => (KO ? ko : en);

  const LISTS = [
    { id: 'l1', name: L('업무', 'Work'),     color: '#0FA958', icon: 'briefcase', folder_id: null, sort_order: 0, created_at: day(-60) },
    { id: 'l2', name: L('개인', 'Personal'), color: '#2C7BE5', icon: 'home',      folder_id: null, sort_order: 1, created_at: day(-60) },
    { id: 'l3', name: L('공부', 'Study'),    color: '#B45309', icon: 'book',      folder_id: null, sort_order: 2, created_at: day(-60) },
  ];

  let n = 0;
  const T = (o) => Object.assign({
    id: 't' + (++n), title: '', description: '', completed: 0, priority: 'none',
    due_date: null, due_time: null, start_date: null, reminder_at: null, pinned: 0,
    list_id: 'l1', parent_id: null, tags: '[]', attachments: '[]', created_at: day(-3),
    completed_at: null, deleted_at: null, sort_order: n, is_recurring: 0,
    recurring_pattern: null, scheduled_start: null, scheduled_end: null, scheduled_overrides: null,
  }, o);
  const tag = (ko, en) => JSON.stringify([L(ko, en)]);

  // 오늘 9건 — '오늘' 화면의 밀도를 위해서다. 스토어 목록에 노출되는 첫 장이라
  // 다섯 줄짜리 빈 목록이면 카테고리에서 가장 흔하고 가장 약한 그림이 된다.
  const TASKS = [
    T({ title: L('팀 주간 미팅', 'Team weekly sync'), due_date: day(0), due_time: '09:30',
        priority: 'medium', tags: tag('회의', 'Meeting'), scheduled_start: at(0,'09','30'), scheduled_end: at(0,'10','00') }),
    T({ title: L('분기 보고서 초안 마무리', 'Finish the quarterly report draft'), due_date: day(0), due_time: '12:00',
        priority: 'high', tags: tag('보고서', 'Report'), scheduled_start: at(0,'10','00'), scheduled_end: at(0,'12','00') }),
    T({ title: L('견적서 보내기', 'Send the quote'), due_date: day(0), due_time: '13:00',
        priority: 'high', tags: tag('영업', 'Sales') }),
    T({ title: L('디자인 리뷰 피드백 반영', 'Apply the design review feedback'), due_date: day(0), due_time: '15:30',
        priority: 'medium', tags: tag('디자인', 'Design'), scheduled_start: at(0,'14','00'), scheduled_end: at(0,'15','30') }),
    T({ title: L('채용 공고 초안 검토', 'Review the job post draft'), due_date: day(0), due_time: '16:30',
        priority: 'medium', tags: tag('채용', 'Hiring') }),
    T({ title: L('운동 — 러닝 5km', 'Run 5 km'), due_date: day(0), due_time: '19:00',
        priority: 'low', list_id: 'l2', tags: tag('건강', 'Health'), scheduled_start: at(0,'19','00'), scheduled_end: at(0,'20','00') }),
    T({ title: L('스페인어 30분', 'Spanish, 30 minutes'), due_date: day(0),
        priority: 'low', list_id: 'l2', tags: tag('언어', 'Language') }),
    T({ title: L('장보기', 'Grocery run'), due_date: day(0), list_id: 'l2', tags: tag('집안일', 'Errands') }),
    T({ title: L('인보이스 보내기', 'Send the invoice'), due_date: day(0), due_time: '10:30',
        priority: 'high', completed: 1, completed_at: day(0), tags: tag('정산', 'Billing') }),

    // 앞으로 — 칸반 '할 일' 열과 아이젠하워 '계획' 사분면을 채운다.
    T({ title: L('계약서 검토', 'Review the contract'), due_date: day(2), due_time: '11:00',
        priority: 'high', tags: tag('법무', 'Legal'), scheduled_start: at(2,'11','00'), scheduled_end: at(2,'12','00') }),
    T({ title: L('신규 온보딩 플로우 정리', 'Map the new onboarding flow'), due_date: day(3),
        priority: 'medium', scheduled_start: at(3,'15','00'), scheduled_end: at(3,'16','30') }),
    T({ title: L('세금 자료 정리', 'Sort out the tax paperwork'), due_date: day(6),
        priority: 'low', list_id: 'l2' }),
    T({ title: L('분기 목표 회고', 'Quarterly goals retro'), due_date: day(9), priority: 'medium' }),
    T({ title: L('『실용주의 프로그래머』 3장', 'The Pragmatic Programmer, ch. 3'), list_id: 'l3' }),

    // 끝낸 것 — 칸반 '완료' 열.
    T({ title: L('경비 정산', 'File the expense report'), due_date: day(-1),
        priority: 'medium', completed: 1, completed_at: day(-1) }),
    T({ title: L('주간 회고 쓰기', 'Write the weekly review'), due_date: day(-1),
        completed: 1, completed_at: day(-1) }),
    T({ title: L('노트북 백업', 'Back up the laptop'), due_date: day(-2),
        list_id: 'l2', completed: 1, completed_at: day(-2) }),
  ];

  const HABITS = [
    { id: 'h1', name: L('아침 스트레칭', 'Morning stretch'), color: '#0FA958', icon: 'sun',
      frequency: 'daily', target_days: '[0,1,2,3,4,5,6]', sort_order: 0, created_at: day(-90) },
    { id: 'h2', name: L('물 2L', 'Drink 2 L of water'), color: '#2C7BE5', icon: 'droplet',
      frequency: 'daily', target_days: '[0,1,2,3,4,5,6]', sort_order: 1, created_at: day(-90) },
    { id: 'h3', name: L('30분 읽기', 'Read for 30 minutes'), color: '#B45309', icon: 'book',
      frequency: 'daily', target_days: '[0,1,2,3,4,5,6]', sort_order: 2, created_at: day(-90) },
  ];

  // 앱은 row.completed 를 읽는다. 예전 스텁이 done:1 을 넣어 로그가 통째로 무시됐고,
  // 그래서 라이트 05 장면이 '0일 연속'에 빈 격자로 찍혔다.
  const STREAK = { h1: 6, h2: 14, h3: 3 };
  const OLDER = { h1: [8,9,10,12,13], h2: [15,16,17,18], h3: [5,6,7,9,11,12] };
  const LOGS = [];
  HABITS.forEach((h) => {
    for (let i = 0; i < STREAK[h.id]; i++) LOGS.push({ id: `${h.id}-${i}`, habit_id: h.id, date: day(-i), completed: 1 });
    (OLDER[h.id] || []).forEach((i) => LOGS.push({ id: `${h.id}-o${i}`, habit_id: h.id, date: day(-i), completed: 1 }));
  });

  const ok = (v) => Promise.resolve(v);
  const api = new Proxy({}, {
    get(_t, k) {
      if (k === 'then') return undefined;
      switch (k) {
        case 'capabilities':   return () => ok({ needsLicenseKey: false, enforcesLicense: false, canSelfUpdate: true, hasGlobalShortcuts: true, isStoreBuild: false });
        case 'licenseGetState':return () => ok({ status: 'licensed', untilMs: null, allowsPaidFeatures: true, enforced: false, maskedKey: null, deviceName: 'Mac' });
        case 'getLists':       return () => ok(LISTS);
        case 'getTasks':       return () => ok(TASKS);
        case 'getFolders':     return () => ok([]);
        case 'getHabits':      return () => ok(HABITS);
        case 'getHabitLogs':   return () => ok(LOGS);
        case 'getTrashTasks':  return () => ok([]);
        case 'getScore':       return () => ok({ total: 420, events: [] });  // normalizeScoreSlice 가 받는 모양
        case 'getPomodoroSessions': return () => ok([]);
        case 'aiGetHistory':   return () => ok([]);
        // ?ai=local 이면 로컬 Ollama에 연결되고 '로컬 전용' 잠금이 켜진 상태로 보인다(설정 장면용).
        case 'aiGetConfig':    return () => ok(AI_LOCAL
          ? { provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'exaone3.5:7.8b', apiKey: null, maxHistoryMessages: 200, localOnly: true }
          : { provider: 'ollama', baseUrl: 'http://localhost:11434', model: '', apiKey: null, maxHistoryMessages: 200, localOnly: false });
        case 'aiCheckConnection': return () => ok(AI_LOCAL ? { connected: true, models: ['exaone3.5:7.8b', 'llama3.2:latest'] } : { connected: false, models: [] });
        case 'calendarGetConfig': return () => ok({ connected: false });
        case 'googleGetConfig':   return () => ok({ connected: false });
        case 'notificationPermission': return () => ok('granted');
        default:
          if (typeof k === 'string' && k.startsWith('on')) return () => () => {};
          return () => ok(undefined);
      }
    },
  });
  window.api = api;
  window.electron = { ipcRenderer: { on: () => {}, send: () => {}, invoke: () => ok(undefined) } };
})();

/* 캡처용 화면 전환. 헤드리스는 클릭을 못 하므로 스크립트가 대신 누른다.
   ?view=오늘,설정 처럼 쉼표로 이으면 차례로 누른다(바탕 화면을 고른 뒤 설정을 여는 식).
   ?scrollto=AI%20어시스턴트 이면 그 글자로 시작하는 요소를 스크롤 영역 맨 위로 가져온다. */
(function () {
  const q = new URLSearchParams(location.search);
  const steps = (q.get('view') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const scrollTo = q.get('scrollto');
  if (!steps.length && !scrollTo) return;
  const find = (want) => [...document.querySelectorAll('button,a,div[role="button"],li')]
    .find((e) => e.textContent.trim() === want || e.textContent.trim().startsWith(want));
  let tries = 0;
  const t = setInterval(() => {
    if (++tries > 80) return clearInterval(t);
    if (steps.length) {
      const el = find(steps[0]);
      if (el) { el.click(); steps.shift(); }
      return;
    }
    if (scrollTo) {
      // 열린 다이얼로그가 있으면 그 안에서만 찾는다 — 사이드바에 같은 글자가 있을 수 있다.
      const root = document.querySelector('[role="dialog"]') || document;
      const el = [...root.querySelectorAll('span,label,div,h3')]
        .find((e) => e.children.length <= 2 && e.textContent.trim().startsWith(scrollTo));
      if (!el) return;
      el.scrollIntoView({ block: 'start' });
    }
    clearInterval(t);
  }, 120);
  // ?dlgmax=440 이면 설정 다이얼로그의 높이를 그만큼으로 잡는다.
  // 창이 낮을 때 실제로 보이는 만큼만 찍기 위한 것이다 — 스토어 장면에서
  // 프라이버시를 말하면서 계정·동기화 입력칸까지 같이 보여주지 않으려고 쓴다.
  const dlgmax = q.get('dlgmax');
  if (dlgmax) {
    const st = document.createElement('style');
    st.textContent = '[role="dialog"]{max-height:' + parseInt(dlgmax, 10) + 'px !important}';
    document.head.appendChild(st);
  }

  // 다이얼로그가 첫 버튼에 포커스를 주면 포커스 링이 찍힌다. 계속 포커스를 뺀다.
  setInterval(() => {
    const a = document.activeElement;
    if (a && a !== document.body) a.blur();
  }, 150);
})();
