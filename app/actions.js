// 동작 목록 — 위 메뉴(menu.js) · 단축키(keymap.js) · 설정 › 단축키 · 단축키 표가 모두 이것을 씀. run 은 앱의 함수를 부르기만 한다.
// label = 사람이 보는 이름, group = 단축키 표·설정에서 묶는 칸, when = 같은 키를 상황에 따라 나눌 때, checked = 켜고 끄는 것.
import { openModal, $ } from './ui.js';
import { openAI } from './bridge.js';
import { AI_PROMPT } from './notes.js';

const REPO_URL = (app) => (app.versionInfo && app.versionInfo.repo ? `https://github.com/${app.versionInfo.repo}` : '');

export function makeActions(app) {
  const E = (fn) => () => (app.notes.agent ? app.agentBlock() : fn());          // 고치는 동작 — 에이전트 모드에선 안내만(고르고 메모하는 모드)
  const ex = (kind, label) => ({ label, group: '파일', run: () => app.doExport(kind) });
  const view = (v, label, opp) => ({ label, group: '보기', run: () => { app.setPlan(null); app.setView(v, opp); } });
  const plan = (v, label) => ({ label, group: '보기', run: () => app.setPlan(v), checked: () => app.plan === v });
  const move = (k, label) => ({ label, group: '카메라', run: E(() => app.addMove(k)) });
  return {
    'file.new': { label: '새 프로젝트…', group: '파일', run: () => app.projects.newDialog(app.templates()) },
    'file.open': { label: '열기…', group: '파일', run: () => app.projects.openDialog() },
    'file.save': { label: '저장', group: '파일', run: () => app.projects.save() },
    'file.saveAs': { label: '다른 이름으로 저장…', group: '파일', run: () => app.projects.save({ as: true }) },
    'file.saveCopy': { label: '사본 저장…', group: '파일', run: () => app.projects.save({ copy: true }) },
    'file.revert': { label: '마지막 저장으로 되돌리기', group: '파일', run: () => app.projects.revert(), enabled: () => !!app.projects.file },
    'file.recover': { label: '자동 저장에서 되살리기…', group: '파일', run: () => app.projects.recoverDialog() },
    'file.import': { label: '프로젝트 파일(JSON) 가져오기…', group: '파일', run: () => $('fileScene').click() },
    'file.importModel': { label: '3D 모델(GLB) 넣기…', group: '파일', run: E(() => $('fileModel').click()) },
    'file.showFolder': { label: '프로젝트 폴더 열기', group: '파일', run: () => fetch('/api/open-folder?which=project', { method: 'POST' }).catch(() => app.warn('앱 서버가 없어 폴더를 열 수 없습니다')) },
    'file.showExports': { label: '내보낸 파일 폴더 열기', group: '파일', run: () => fetch('/api/open-folder?which=export', { method: 'POST' }).catch(() => {}) },
    'file.quit': { label: '끝내기', group: '파일', run: async () => { if (await app.projects.confirmDiscard()) { app.projects.dirty = false; window.close(); } } },
    'export.mp4': ex('mp4', 'MP4 영상 (무빙 전체 · 구간)'), 'export.png': ex('png', 'PNG 그림 (지금 화면)'), 'export.sheet': ex('sheet', '장면 시트 PNG'),
    'export.plan': ex('plan', '도면 PNG (평면·정면·측면)'), 'export.shots': ex('shots', '샷 리스트 (HTML·CSV)'), 'export.glb': ex('glb', '블렌더로 보내기 (.glb)'),

    'edit.undo': { label: '되돌리기', group: '편집', run: () => app.undo(), enabled: () => app.hist.length > 0 },
    'edit.redo': { label: '다시 하기', group: '편집', run: () => app.redo(), enabled: () => app.redoStack.length > 0 },
    'edit.copy': { label: '복사', group: '편집', run: () => app.copySel() },
    'edit.paste': { label: '붙여넣기', group: '편집', run: E(() => app.pasteClip()) },
    'edit.cut': { label: '잘라내기', group: '편집', run: E(() => app.cutSel()) },
    'edit.duplicate': { label: '복제', group: '편집', run: E(() => app.duplicateObj(app.selObj)), enabled: () => !!app.selObj, when: () => !!app.selObj },   // 고른 물체가 없으면 Shift+D 는 오른쪽으로 빠르게
    'edit.delete': { label: '지우기', group: '편집', run: E(() => app.deleteSel()) },
    'edit.escape': { label: '고른 것 풀기 · 하던 것 그만', group: '편집', run: () => app.escape() },
    'edit.reset': { label: '세트를 처음 상태로…', group: '편집', run: E(() => app.resetSet()) },

    'shot.take': { label: '여기 찍기 (카메라 장면)', group: '카메라', run: E(() => app.snapshot()) },
    'shot.record': { label: '녹화 시작 · 끝', group: '카메라', run: E(() => app.toggleRecord()), checked: () => !!app.recording },
    'shot.prev': { label: '이전 장면', group: '카메라', run: () => app.step(-1) },
    'shot.next': { label: '다음 장면', group: '카메라', run: () => app.step(1) },
    'move.dollyIn': move('dollyIn', '밀어 들어가기'), 'move.dollyOut': move('dollyOut', '빠져나오기'), 'move.craneUp': move('craneUp', '크레인 업'), 'move.craneDown': move('craneDown', '크레인 다운'),
    'move.trackL': move('trackL', '왼쪽 트래킹'), 'move.trackR': move('trackR', '오른쪽 트래킹'), 'move.arcL': move('arcL', '왼쪽으로 돌기'), 'move.arcR': move('arcR', '오른쪽으로 돌기'),
    'move.tiltUp': move('tiltUp', '틸트 업'), 'move.tiltDown': move('tiltDown', '틸트 다운'), 'move.dollyZoom': move('dollyZoom', '돌리 줌'),
    'speed.down': { label: '이동 속도 줄이기', group: '카메라', run: () => app.setSpeed(app.prefs.speed * 0.8) },
    'speed.up': { label: '이동 속도 늘리기', group: '카메라', run: () => app.setSpeed(app.prefs.speed * 1.25) },
    'lens.wider': { label: '렌즈 넓게', group: '카메라', run: () => app.nudgeLens(-1) },
    'lens.narrower': { label: '렌즈 좁게', group: '카메라', run: () => app.nudgeLens(1) },

    'obj.key': { label: '고른 물체의 지금 자리를 키로', group: '물체', run: E(() => app.addObjKey()) },
    'gizmo.translate': { label: '기즈모: 이동', group: '물체', run: () => app.setGizmoMode('translate'), when: () => !!app.selObj },
    'gizmo.rotate': { label: '기즈모: 회전', group: '물체', run: () => app.setGizmoMode('rotate'), when: () => !!app.selObj },
    'gizmo.scale': { label: '기즈모: 크기', group: '물체', run: () => app.setGizmoMode('scale'), when: () => !!app.selObj },
    'gizmo.cycle': { label: '기즈모 바꾸기', group: '물체', run: () => { const ms = ['translate', 'rotate', 'scale']; app.setGizmoMode(ms[(ms.indexOf(app.tc.mode) + 1) % 3]); }, when: () => !!app.selObj },

    'play.toggle': { label: '재생 · 일시정지', group: '시간', run: () => app.togglePlay() },
    'play.fromStart': { label: '처음부터 재생', group: '시간', run: () => app.playFromStart() },
    'time.start': { label: '처음으로', group: '시간', run: () => app.timeStart() },
    'time.end': { label: '끝으로', group: '시간', run: () => app.timeEnd() },
    'frame.prev': { label: '한 프레임 앞', group: '시간', run: () => app.stepFrame(-1) },
    'frame.next': { label: '한 프레임 뒤', group: '시간', run: () => app.stepFrame(1) },
    'frame.prev10': { label: '10 프레임 앞', group: '시간', run: () => app.stepFrame(-10) },
    'frame.next10': { label: '10 프레임 뒤', group: '시간', run: () => app.stepFrame(10) },
    'time.snap': { label: '키에 자석처럼 붙기', group: '시간', run: () => app.toggleSnap(), checked: () => !!app.prefs.snap },
    'range.in': { label: '구간 시작 = 지금', group: '시간', run: () => app.setRange('in') },
    'range.out': { label: '구간 끝 = 지금', group: '시간', run: () => app.setRange('out') },
    'range.clear': { label: '구간 지우기', group: '시간', run: () => app.setRange(null), enabled: () => !!app.state.range },
    'play.loop': { label: '반복 재생', group: '시간', run: () => app.toggleLoop(), checked: () => !!app.prefs.loop },

    'view.cycle': { label: '평면도 · 정면도 · 측면도 · 3D 돌아가며', group: '보기', run: () => { const o = [null, 'top', 'front', 'side']; app.setPlan(o[(o.indexOf(app.plan) + 1) % 4]); } },
    'view.3d': { label: '3D', group: '보기', run: () => app.setPlan(null), checked: () => !app.plan },
    'view.planTop': plan('top', '위 평면도'), 'view.planFront': plan('front', '정면도'), 'view.planSide': plan('side', '측면도'),
    'view.front': view('front', '앞에서 보기', false), 'view.right': view('right', '오른쪽에서 보기', false), 'view.top': view('top', '위에서 보기', false),
    'view.back': view('front', '뒤에서 보기', true), 'view.left': view('right', '왼쪽에서 보기', true), 'view.bottom': view('top', '아래에서 보기', true),
    'view.focus': { label: '고른 물체로', group: '보기', run: () => app.setView('focus'), when: () => !!app.selObj },
    'view.walk': { label: '걷기 모드 (눈높이)', group: '보기', run: () => app.toggleWalk(!app.walk), checked: () => !!app.walk },
    'look.outline': { label: '윤곽선', group: '보기', run: () => app.toggleLook('outline'), checked: () => !!app.planV.outlineOn },
    'look.xray': { label: '엑스레이', group: '보기', run: () => app.toggleLook('xray'), checked: () => !!app.planV.xrayOn },
    'view.letterbox': { label: '2.39:1 레터박스', group: '보기', run: () => { app.prefs.letterbox = !app.prefs.letterbox; app.savePrefs(); app.syncPrefsUI(); app.layoutGuides(); }, checked: () => !!app.prefs.letterbox },
    'tool.measure': { label: '자 (거리 재기)', group: '보기', run: () => app.toggleMeasure(), checked: () => !!app.measure },
    'view.easy': { label: '쉬운 모드 (꼭 필요한 것만)', group: '보기', run: () => app.setEasy(!app.prefs.easy), checked: () => !!app.prefs.easy },

    'mode.toggle': { label: '에이전트 모드 ↔ 수동 수정 모드', group: 'AI', run: () => app.notes.setAgent(!app.notes.agent), checked: () => app.notes.agent },
    'note.add': { label: '수정 메모 쓰기', group: 'AI', run: () => { app.showTab('notes'); $('noteText').focus(); } },
    'tool.path': { label: '동선 그리기', group: 'AI', run: () => app.notes.togglePath(), checked: () => !!app.notes.path },
    'ai.connect': { label: 'AI 연결 (Claude · ChatGPT)…', group: 'AI', run: () => openAI(app, app.ai) },
    'ai.copyPrompt': { label: 'AI 에게 메모 맡기기', group: 'AI', run: () => (app.aiReady() ? app.copyText(AI_PROMPT, '복사함 — Claude · ChatGPT 채팅에 붙여 넣으세요') : openAI(app, app.ai)) },

    'prefs.open': { label: '환경 설정…', group: '설정', run: () => app.prefsUI.open() },
    'prefs.keys': { label: '단축키 바꾸기…', group: '설정', run: () => app.prefsUI.open('keys') },
    'help.manual': { label: '사용 설명서', group: '도움말', run: () => openModal('help') },
    'help.keys': { label: '단축키 표', group: '도움말', run: () => app.showKeys() },
    'help.coach': { label: '따라 하기 안내 다시 보기', group: '도움말', run: () => app.coachStart() },
    'help.update': { label: '업데이트 확인', group: '도움말', run: () => app.updates.open() },
    'help.releases': { label: '바뀐 점 (릴리스 노트)', group: '도움말', run: () => { const u = REPO_URL(app); if (u) window.open(`${u}/releases`, '_blank'); }, enabled: () => !!REPO_URL(app) },
    'help.issues': { label: '문제 알리기 · 제안하기', group: '도움말', run: () => { const u = REPO_URL(app); if (u) window.open(`${u}/issues`, '_blank'); }, enabled: () => !!REPO_URL(app) },
    'help.about': { label: '블록아웃 스튜디오 정보', group: '도움말', run: () => app.prefsUI.open('about') },

    'move.forward': { label: '앞으로', group: '날기(누르고 있기)' }, 'move.back': { label: '뒤로', group: '날기(누르고 있기)' },
    'move.left': { label: '왼쪽으로', group: '날기(누르고 있기)' }, 'move.right': { label: '오른쪽으로', group: '날기(누르고 있기)' },
    'move.up': { label: '위로', group: '날기(누르고 있기)' }, 'move.down': { label: '아래로', group: '날기(누르고 있기)' },
    'turn.left': { label: '고개 왼쪽', group: '날기(누르고 있기)' }, 'turn.right': { label: '고개 오른쪽', group: '날기(누르고 있기)' },
    'roll.left': { label: '기울기 왼쪽', group: '날기(누르고 있기)' }, 'roll.right': { label: '기울기 오른쪽', group: '날기(누르고 있기)' },
  };
}

// 위 메뉴 — 항목은 동작 id, '-' 는 구분선, { label, items } 는 하위 메뉴, { label, list } 는 그때그때 만드는 목록(최근 파일 등)
export function makeMenus(app) {
  return [
    { label: '파일', items: ['file.new', 'file.open', { label: '최근 프로젝트', list: () => app.projects.recent().map((r) => ({ label: r.name, run: () => app.projects.openFile(r.file) })) }, '-',
      'file.save', 'file.saveAs', 'file.saveCopy', 'file.revert', 'file.recover', '-',
      'file.import', 'file.importModel', { label: '내보내기', items: ['export.mp4', 'export.png', 'export.sheet', 'export.plan', 'export.shots', '-', 'export.glb'] }, '-',
      'file.showFolder', 'file.showExports', '-', 'file.quit'] },
    { label: '편집', items: ['edit.undo', 'edit.redo', '-', 'edit.copy', 'edit.paste', 'edit.cut', 'edit.duplicate', 'edit.delete', '-',
      'shot.take', 'shot.record', { label: '무빙 넣기', items: ['move.dollyIn', 'move.dollyOut', 'move.craneUp', 'move.craneDown', 'move.trackL', 'move.trackR', 'move.arcL', 'move.arcR', 'move.tiltUp', 'move.tiltDown', 'move.dollyZoom'] },
      'obj.key', '-', 'edit.reset'] },
    { label: '보기', items: ['view.3d', 'view.planTop', 'view.planFront', 'view.planSide', '-', 'view.front', 'view.right', 'view.top', 'view.focus', '-',
      'play.toggle', 'play.fromStart', 'time.start', 'time.end', 'time.snap', 'play.loop', '-', 'look.outline', 'look.xray', 'view.letterbox', 'view.walk', 'tool.measure', '-', 'view.easy'] },
    { label: '플러그인', items: ['ai.connect', 'ai.copyPrompt', '-', 'mode.toggle', 'note.add', 'tool.path', '-', 'export.glb'] },
    { label: '설정', items: ['prefs.open', 'prefs.keys'] },
    { label: '도움말', items: ['help.manual', 'help.keys', 'help.coach', '-', 'help.update', 'help.releases', 'help.issues', '-', 'help.about'] },
  ];
}
