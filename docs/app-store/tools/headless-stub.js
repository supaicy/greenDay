/* 화면 캡처용 스텁. Electron 없이 렌더러를 띄운다 —
   사용자의 화면을 뺏지 않고 라이트/다크·크기별로 찍기 위해서다.
   실제 빌드는 건드리지 않는다: out/renderer 를 /tmp 로 복사한 사본에만 넣는다. */
(function () {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const today = new Date();
  const day = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
  // 테마는 localStorage 에서 온다. ?theme=light 로 갈아끼운다.
  const wanted = new URLSearchParams(location.search).get('theme');
  if (wanted) localStorage.setItem('ticktick-theme', wanted);

  const LISTS = [
    { id: 'l1', name: '업무',   color: '#0FA958', icon: 'briefcase', folder_id: null, sort_order: 0, created_at: day(-30) },
    { id: 'l2', name: '개인',   color: '#2C7BE5', icon: 'home',      folder_id: null, sort_order: 1, created_at: day(-30) },
    { id: 'l3', name: '읽을거리', color: '#B45309', icon: 'book',    folder_id: null, sort_order: 2, created_at: day(-30) },
  ];

  let n = 0;
  const T = (o) => Object.assign({
    id: 't' + (++n), title: '', description: '', completed: 0, priority: 'none',
    due_date: null, due_time: null, start_date: null, reminder_at: null, pinned: 0,
    list_id: 'l1', parent_id: null, tags: '[]', attachments: '[]', created_at: day(-3),
    completed_at: null, deleted_at: null, sort_order: n, is_recurring: 0,
    recurring_pattern: null, scheduled_start: null, scheduled_end: null, scheduled_overrides: null,
  }, o);

  const TASKS = [
    T({ title: '견적서 보내기',        due_date: day(1), due_time: '15:00', priority: 'high',   tags: '["영업"]', status: 'doing' }),
    T({ title: '분기 보고서 초안 마무리', due_date: day(0), due_time: '14:00', priority: 'high',   tags: '["보고서"]', status: 'doing' }),
    T({ title: '디자인 리뷰 피드백 반영', due_date: day(0), due_time: '17:00', priority: 'medium', tags: '["디자인"]' }),
    T({ title: '팀 주간 미팅',         due_date: day(0), due_time: '09:30', priority: 'medium', tags: '["회의"]', completed: 1, completed_at: day(0) }),
    T({ title: '운동 — 러닝 5km',      due_date: day(0), due_time: '19:00', priority: 'low',    list_id: 'l2', tags: '["건강"]' }),
    T({ title: '스페인어 30분',        due_date: day(0),                    priority: 'low',    list_id: 'l2', tags: '["언어"]' }),
    T({ title: '계약서 검토',          due_date: day(2), due_time: '11:00', priority: 'high',   tags: '["법무"]', status: 'todo' }),
    T({ title: '신규 온보딩 플로우 정리', due_date: day(3),                  priority: 'medium', status: 'todo' }),
    T({ title: '경비 정산',            due_date: day(-1),                   priority: 'medium', completed: 1, completed_at: day(-1) }),
    T({ title: '『실용주의 프로그래머』 3장', list_id: 'l3',                  priority: 'none' }),
    T({ title: '분기 목표 회고',        start_date: day(1), due_date: day(4), priority: 'medium' }),
  ];

  const HABITS = [
    { id: 'h1', name: '아침 스트레칭', color: '#0FA958', icon: 'sun',   target_days: 7, sort_order: 0, created_at: day(-40) },
    { id: 'h2', name: '물 2L',        color: '#2C7BE5', icon: 'droplet', target_days: 7, sort_order: 1, created_at: day(-40) },
    { id: 'h3', name: '30분 읽기',     color: '#B45309', icon: 'book',  target_days: 5, sort_order: 2, created_at: day(-40) },
  ];
  const LOGS = [];
  HABITS.forEach((h, hi) => {
    for (let i = 0; i < 21; i++) {
      if ((i + hi) % 4 !== 3) LOGS.push({ id: `hl${hi}${i}`, habit_id: h.id, date: day(-i), done: 1 });
    }
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
        case 'getScore':       return () => ok({ level: 4, points: 428, streak: 12 });
        case 'getPomodoroSessions': return () => ok([]);
        case 'aiGetHistory':   return () => ok([]);
        case 'aiGetConfig':    return () => ok({ enabled: false, model: '', baseUrl: '' });
        case 'aiCheckConnection': return () => ok({ ok: false });
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

/* 캡처용 화면 전환. 헤드리스는 클릭을 못 하므로 스크립트가 대신 누른다. */
(function () {
  const want = new URLSearchParams(location.search).get('view');
  if (!want) return;
  let tries = 0;
  const t = setInterval(() => {
    if (++tries > 60) return clearInterval(t);
    const el = [...document.querySelectorAll('button,a,div[role="button"],li')]
      .find((e) => e.textContent.trim() === want || e.textContent.trim().startsWith(want));
    if (el) { el.click(); clearInterval(t); }
  }, 100);
})();
