import './style.css';
import { PARTS, CATEGORIES, COLORS, getPart } from './catalog.js';
import { createDocument, validateDocument, serializeDocument, getBounds, getConnections, getAssemblyStats, snapPlacement } from './model.js';
import { createWorkshopScene, createThumbnails } from './scene.js';
import { icon } from './icons.js';
import { loadPartAssets, loadTransformerDemo } from './assets.js';
import { createDemoRuntime } from './demo.js';
import { evaluatePose, validateJointCreation, getPoseCollisions } from './joints.js';
import { createPlaytest, MODULE_ROLES } from './playtest.js';
import { rotateInstance, rotateOrientation, canEditInstance } from './editing.js';
import { writeDraft, getRecoveryKey } from './storage.js';
import { analyzeSupport, checkBuildChange, groundComponent, getComponentIds, translateComponent } from './building-support.js';

const STORAGE_KEY = 'brick-workshop-document-v2';
let material = 'glass';
try{if(localStorage.getItem('brick-workshop-material')==='solid')material='solid';}catch{}
document.body.dataset.material=material;
const $ = selector => document.querySelector(selector);
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clone = value => structuredClone(value);
const NUDGES = [
  ['ArrowLeft','X −','x',-1],['ArrowRight','X +','x',1],
  ['ArrowUp','Z −','z',-1],['ArrowDown','Z +','z',1],
  ['PageDown','高度 −','y',-1],['PageUp','高度 +','y',1],
];
let doc = createDocument();
let startupError = '';
let savedRaw = null, unreadableRaw = null, recoveryRaw = null;
try {
  savedRaw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('brick-workshop-document-v1');
  if (savedRaw) doc = validateDocument(JSON.parse(savedRaw));
  recoveryRaw = localStorage.getItem(getRecoveryKey(STORAGE_KEY));
} catch { unreadableRaw = recoveryRaw = savedRaw; startupError = '旧草稿未能读取，可先下载原文件。新作品保存前会保留原文备份。'; }
let selectedId = null;
let placingId = null;
let movingId = null;
let movingComponentIds = null;
let rotation = 0;
let rotationX = 0, rotationZ = 0, rotateAxis = 'y', placementLift = 0;
let placementQuaternion = null;
let placementSource = null, jointPickTarget = null;
let placementBaseHeight=0;
let mode = 'build', preview = 0, previewPlaying = false, previewDirection = 1, poseOverrides = null;
let selectedJointId = null, jointDraft = null, demoRuntime = null, simulation = null, assetsReady = false;
let hudClock = 0, challengeComplete = false;
const pressed = new Set();
let color = COLORS[0].hex;
let candidate = null;
let validCandidate = false;
let placementReason = '';
let previewId = crypto.randomUUID();
let snapping = true;
let gridVisible = true;
let category = 'all';
let query = '';
let scene;
let undoStack = [];
let redoStack = [];
let saveTimer;
let toastTimer;
let draftDirty = false;
let statusMessage = '';
let thumbnails = new Map();
const app = $('#app');
app.innerHTML = `
  <header class="app-header">
    <div class="document-group"><a class="brand" href="./" aria-label="积木工坊首页"><span class="brand-symbol">${icon('cube', 20)}</span><span>积木工坊</span></a>
    <div class="project"><input id="project-name" aria-label="作品名称" maxlength="60" value="${escape(doc.name)}"><span class="save-state" id="save-state"><i></i>保存在此浏览器</span></div></div>
    <nav class="mode-tabs" aria-label="游戏模式"><button data-mode="build" class="active">搭建</button><button data-mode="joints">变形</button><button data-mode="test">试车</button></nav>
    <nav class="header-actions" aria-label="作品操作">
      <button class="button quiet" id="new-project" aria-label="新建空白作品" title="新建空白作品">${icon('plus')}<span>新建</span></button>
      <button class="button quiet" id="example" aria-label="打开示例与练习" title="打开示例与练习">${icon('plane')}<span>示例</span></button>
      <span class="divider"></span>
      <button class="button icon-only" id="import" aria-label="导入作品" title="导入作品文件">${icon('upload')}</button>
      <button class="button icon-only" id="export" aria-label="导出作品" title="导出作品文件">${icon('download')}</button>
      <button class="button primary" id="save" aria-label="保存作品" title="保存作品 Ctrl+S">${icon('save')}<span>保存</span></button>
    </nav>
  </header>
  <main class="workshop">
    <aside class="parts-panel" aria-label="零件库">
      <div class="library-heading"><div><h1>零件库 <span>${PARTS.length}</span></h1></div><span class="library-symbol">${icon('layers', 24)}</span></div>
      <label class="search">${icon('search', 17)}<input type="search" id="part-search" placeholder="搜索零件名称、尺寸" aria-label="搜索零件"></label>
      <div class="category-list"><select id="part-category" aria-label="零件分类">${CATEGORIES.map(c => `<option value="${c.id}">${escape(c.name)}</option>`).join('')}</select><span>无限取件</span></div>
      <div class="parts-scroll"><div id="parts-list" class="parts-list"></div><p id="no-results" class="no-results" hidden>没有找到零件<br><span>试试“薄板”或“2 × 4”</span></p></div>
      <div class="palette-section"><div class="palette-heading"><span>积木颜色</span><span id="color-name">机械灰</span></div><div class="palette" role="group" aria-label="积木颜色">${COLORS.map(c => `<button class="swatch ${c.hex === color ? 'active' : ''}" style="--swatch:${c.hex}" data-color="${c.hex}" aria-label="${c.name}" title="${c.name}" aria-pressed="${c.hex === color}"><span>${icon('check', 14)}</span></button>`).join('')}</div></div>
      <footer class="library-footer"><span>${PARTS.length} 种零件</span><span>点击取用</span></footer>
    </aside>
    <section class="stage" aria-label="搭建区域">
      <div id="scene" class="scene"></div>
      <div class="stage-top"><div class="workspace-label"><span class="workspace-icon">${icon('cube', 16)}</span><strong>自由工作台</strong><span class="stage-count" id="stage-count">0 块积木</span></div><div class="view-options" role="group" aria-label="相机视图"><button data-view="iso" class="active" aria-pressed="true">等轴</button><button data-view="top" aria-pressed="false">俯视</button><button data-view="front" aria-pressed="false">正视</button><button id="module-visibility" aria-pressed="true" title="显示功能模块标记" aria-label="显示功能模块标记">${icon('layers',16)}</button><button id="focus" title="聚焦作品 F" aria-label="聚焦作品">${icon('focus', 16)}</button></div></div>
      <div id="recovery-notice" class="recovery-notice" ${recoveryRaw?'':'hidden'}><span>保留了一份未能读取的旧草稿。</span><button id="download-recovery">下载原文件</button><button id="dismiss-recovery" aria-label="收起草稿提醒">${icon('close',14)}</button></div>
      <div class="empty-state" id="empty-state"><h2>开始搭建</h2><p>从零件库取一块，放到工作台。</p><button id="empty-example" class="text-button">看看变形机甲 ${icon('chevron', 14)}</button><button id="empty-drive" class="text-button">先玩动力滑板 ${icon('chevron', 14)}</button></div>
      <div class="placement-banner" id="placement-banner" hidden><span class="placement-dot"></span><strong id="placement-name"></strong><span id="placement-status">点击放置</span><kbd>R</kbd><span>旋转</span><button id="cancel-placement" aria-label="结束放置" title="结束放置 Esc">${icon('close', 16)}</button></div>
      <section id="inspector" class="inspector" aria-label="零件属性" hidden></section>
      <section id="joint-panel" class="joint-panel" aria-label="变形设置" hidden></section>
      <div id="pose-bar" class="pose-bar" hidden><button id="preview-play" class="button small">播放变形</button><span>A</span><input id="pose-progress" type="range" min="0" max="100" value="0" aria-label="变形进度"><span>B</span><output id="pose-percent">0%</output><span id="collision-status"></span></div>
      <div id="demo-info" class="demo-info" hidden><strong>机械变形示例</strong><span>77 块独立积木 · 飞机 / 人形</span><button id="demo-import" class="button small primary">拆成零件开搭</button><button id="demo-close" class="small-icon" aria-label="关闭示例">${icon('close',16)}</button></div>
      <section id="game-hud" class="game-hud" aria-label="试车状态" hidden><section class="course-map" aria-label="试车场小地图"><svg id="course-map" viewBox="-9 -21 32 36" aria-label="能量环和作品位置" role="img"></svg><span id="course-target"></span></section><div><span>能量环</span><strong id="gate-count">0 / 5</strong></div><div><span>电量</span><strong id="battery-value">—</strong></div><progress id="battery-meter" max="1" value="1" aria-label="剩余电量"></progress><div><span>速度 <small>格/秒</small></span><strong id="speed-value">0.0</strong></div><p id="drive-status"></p><p id="vehicle-modules"></p><button id="reset-drive" class="button small">重置 R</button></section>
      <div id="test-controls" class="test-controls" hidden><span>W / S 前进后退</span><span>A / D 转向</span><span>空格 推升 / 刹车</span><button id="transform-drive">伺服变形 T</button><button id="follow-toggle" aria-pressed="true">跟随视角</button><div class="touch-drive">${[['KeyA','左转'],['KeyW','前进'],['KeyD','右转'],['KeyS','后退'],['Space','推升']].map(([key,label])=>`<button data-drive-key="${key}">${label}</button>`).join('')}</div></div>
      <div id="loading-assets" class="asset-loading"><span class="loading-cube">${icon('cube',34)}</span><strong id="loading-label">正在载入 Blender 零件…</strong><span>孔梁、轴销、铰链与真实底部结构</span></div>
      <div class="scene-error" id="scene-error" hidden><h2>3D 工作台暂时无法启动</h2><p>请使用支持 WebGL 的浏览器，并启用硬件加速后重试。</p><p id="scene-error-detail"></p></div>
      <div class="bottom-tools"><div class="tool-group" role="toolbar" aria-label="编辑工具"><button id="select-tool" class="tool active" aria-label="选择零件" title="选择 V">${icon('arrow')}<span>选择</span><kbd>V</kbd></button><span class="tool-divider"></span><button id="rotate-tool" class="tool" aria-label="旋转零件" title="旋转 R">${icon('rotate')}<span>旋转</span></button><button id="move-tool" class="tool" aria-label="移动零件" title="移动选中零件">${icon('move')}<span>移动</span></button><button id="duplicate-tool" class="tool" aria-label="复制零件" title="复制 Ctrl+D">${icon('copy')}<span>复制</span></button><button id="delete-tool" class="tool danger" aria-label="删除零件" title="删除 Delete">${icon('trash')}</button><span class="tool-divider"></span><button id="undo-tool" class="tool" aria-label="撤销" title="撤销 Ctrl+Z">${icon('undo')}</button><button id="redo-tool" class="tool" aria-label="重做" title="重做 Ctrl+Shift+Z">${icon('redo')}</button></div></div>
      <div class="stage-bottom"><div class="toggle-tools"><button id="snap-toggle" class="toggle active" aria-pressed="true" title="凸点与网格吸附">${icon('magnet', 16)}<span>吸附</span></button><button id="grid-toggle" class="toggle active" aria-pressed="true" title="显示网格">${icon('grid', 16)}<span>网格</span></button><button id="material-toggle" class="toggle active" aria-label="毛玻璃界面" aria-pressed="true" title="切换毛玻璃与实色界面">毛玻璃</button><select id="rotation-axis" aria-label="旋转轴"><option value="y">绕 Y 旋转</option><option value="x">绕 X 翻转</option><option value="z">绕 Z 翻转</option></select></div><p class="camera-hint"><span>右键环绕</span><span>滚轮缩放</span></p><button class="help-button" id="help" title="操作帮助" aria-label="操作帮助">${icon('help', 20)}</button></div>
    </section>
  </main>
  <footer class="status-bar"><span id="mode-status"><i></i>选择零件，开始搭建</span><span id="assembly-status">无限灵感，自由搭建</span><span class="status-scale">1 格 = 1 凸点</span></footer>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <input type="file" id="file-input" accept="application/json,.json" hidden>
  <dialog id="examples-dialog"><button class="dialog-close" id="examples-close" aria-label="关闭示例">${icon('close')}</button><h2>示例与练习</h2><p>打开示例，熟悉关节、变形和动力模块。</p><div class="example-options"><button id="load-transformer">${icon('plane',26)}<strong>变形机甲</strong><span>查看 Blender 模型变形，也能拆成零件。</span></button><button id="load-hinge">${icon('rotate',26)}<strong>折翼练习</strong><span>调整一条关节，看整块机翼跟随转动。</span></button><button id="load-drive">${icon('move',26)}<strong>动力滑板</strong><span>已装电池和推进模块，直接进场驾驶。</span></button></div></dialog>
  <dialog id="confirm-dialog"><form method="dialog"><button class="dialog-close" value="cancel" aria-label="取消">${icon('close')}</button><h2 id="confirm-title"></h2><p id="confirm-copy"></p><div class="dialog-actions"><button class="button quiet" value="cancel">取消</button><button class="button primary" value="confirm">继续</button></div></form></dialog>
  <dialog id="help-dialog"><form method="dialog"><button class="dialog-close" aria-label="关闭帮助">${icon('close')}</button><h2>搭好，再让它动起来</h2><p>47 种零件全部开放。三个模式随时切换。</p><dl class="shortcut-list"><div><dt>自由搭建</dt><dd>取件后点击工作台，可连续放置<br>R 旋转 · 选择 X / Y / Z 轴<br>PgUp / PgDn 调整放置高度</dd></div><div><dt>选中件微调</dt><dd>方向键移动 · PgUp/PgDn 调高<br>Shift 精调 0.1 格</dd></div><div><dt>结束放置 / 选择</dt><dd><kbd>Esc</kbd> / <kbd>V</kbd></dd></div><div><dt>关节变形</dt><dd>在“变形”中添加关节<br>设置父子组件、轴心、A / B 角度<br>拖动进度条，或记录命名姿态</dd></div><div><dt>挂载模块</dt><dd>选中零件，在属性中挂载电池、<br>推进、驱动轮组或伺服模块<br>连接到同一装配体才能供能</dd></div><div><dt>试车</dt><dd>WASD 驾驶 · 空格推升 / 刹车<br>T 伺服变形 · R 重置<br>收集场地中的 5 个能量环</dd></div><div><dt>复制 / 删除</dt><dd><kbd>Ctrl D</kbd> / <kbd>Delete</kbd></dd></div><div><dt>撤销 / 重做</dt><dd><kbd>Ctrl Z</kbd> / <kbd>Ctrl Shift Z</kbd></dd></div><div><dt>聚焦 / 保存</dt><dd><kbd>F</kbd> / <kbd>Ctrl S</kbd></dd></div><div><dt>相机</dt><dd>右键环绕 · 滚轮缩放<br>Shift + 右键平移</dd></div></dl><p class="help-note">自动保存到此浏览器。导出文件可跨设备继续。零件须接地、接合或获得表面承托。销孔精确插接仍待完善；驾驶采用简化的游戏动力。</p><button class="button primary dialog-done">开始搭建</button></form></dialog>
`;

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').className = `toast visible${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => { $('#toast').className = 'toast'; }, 3400);
}
function downloadText(text, filename) {
  const url=URL.createObjectURL(new Blob([text],{type:'application/json'})), link=document.createElement('a');
  link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function save(manual = false) {
  clearTimeout(saveTimer);
  try {
    writeDraft(localStorage, STORAGE_KEY, serializeDocument(doc), unreadableRaw);
    $('#save-state').innerHTML = '<i></i>已保存在此浏览器';
    $('#save-state').classList.remove('unsaved');
    draftDirty = false;
    if (manual) toast('作品已保存在此浏览器');
  } catch {
    $('#save-state').textContent = '保存失败，请导出备份';
    $('#save-state').classList.add('unsaved');
    toast('无法保存到浏览器，请导出作品文件备份。', true);
  }
}
function changed(next, label = '', { restore = false } = {}) {
  try { next = validateDocument(next); } catch (error) { toast(error.message, true); return false; }
  if(!restore){const check=checkBuildChange(doc,next);if(!check.valid){toast(check.reason,true);return false;}}
  if (demoRuntime) { demoRuntime = null; $('#demo-info').hidden = true; }
  undoStack.push(clone(doc));
  if (undoStack.length > 80) undoStack.shift();
  redoStack = [];
  doc = next;
  draftDirty = true;
  statusMessage = label;
  $('#save-state').innerHTML = '<i></i>正在保存…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(), 300);
  renderDocument();
  return true;
}
function renderDocument() {
  if (!doc.parts.some(p => p.id === selectedId)) selectedId = null;
  scene?.setParts(demoRuntime?.parts ?? doc.parts);
  scene?.select(selectedId);
  $('#project-name').value = demoRuntime?'变形机甲 · 展示':doc.name;
  $('#project-name').disabled=!!demoRuntime;
  $('#save').disabled=$('#export').disabled=!!demoRuntime;
  $('#empty-state').hidden = !!doc.parts.length || !!placingId || !!demoRuntime || mode !== 'build';
  $('#stage-count').textContent = `${demoRuntime?.parts.length ?? doc.parts.length} 块积木`;
  $('#undo-tool').disabled = !undoStack.length;
  $('#redo-tool').disabled = !redoStack.length;
  const stats = getAssemblyStats(doc.parts);
  const unsupported=analyzeSupport(doc.parts,doc.joints).unsupportedIds.size;
  $('#assembly-status').textContent = demoRuntime ? 'Blender 变形示例 · 可拆为零件继续搭建' : doc.parts.length ? `${unsupported?`${unsupported} 件尚无支撑 · 选中后可放回地面`:`${stats.assemblies} 个固定组件`} · ${doc.joints.length} 个关节 · 估算 ${stats.weight.toFixed(1)} g` : '无限灵感，自由搭建';
  renderInspector();
  renderMode();
  renderJointPanel();
  if (mode === 'joints') applyPreview();
}
function renderMode() {
  const selected = doc.parts.find(p => p.id === selectedId);
  for (const id of ['move-tool', 'duplicate-tool', 'delete-tool']) $(`#${id}`).disabled = !selected || !!placingId || mode !== 'build' || !!demoRuntime;
  $('#rotate-tool').disabled = (!selected && !placingId) || mode !== 'build' || !!movingComponentIds;
  $('#rotation-axis').disabled=!!movingComponentIds;
  document.querySelectorAll('[data-color]').forEach(button=>{button.disabled=!!movingComponentIds;});
  $('#select-tool').classList.toggle('active', !placingId);
  $('#scene').classList.toggle('placing', !!placingId);
  $('#placement-banner').hidden = !placingId;
  $('#empty-state').hidden = !!doc.parts.length || !!placingId || !!demoRuntime || mode !== 'build';
  if (placingId) {
    $('#placement-name').textContent = movingComponentIds?`移动组件 · ${movingComponentIds.size} 件`:`${movingId ? '移动' : '放置'} ${getPart(placingId).name}`;
    $('#mode-status').innerHTML = movingComponentIds?'<i></i>移动整个组件 · 点击放下 · Esc 取消':`<i></i>${movingId ? '移动零件' : '点击放置'} · R 绕 ${rotateAxis.toUpperCase()} 轴 · PgUp/PgDn 调高度`;
  } else $('#mode-status').innerHTML = `<i></i>${escape(demoRuntime ? '拖动进度条，预览飞机 / 人形' : mode === 'test' ? 'WASD 驾驶 · 空格推升 / 刹车 · R 重置' : mode === 'joints' ? '设置父子组件、轴心和两种姿态' : statusMessage || (selected ? `已选中 ${getPart(selected.partId).name}` : '选择零件，开始搭建'))}`;
  document.querySelectorAll('[data-mode]').forEach(el => {el.classList.toggle('active', el.dataset.mode === mode);el.setAttribute('aria-pressed',String(el.dataset.mode===mode));});
  $('.bottom-tools').hidden = mode !== 'build';
  $('#pose-bar').hidden = mode !== 'joints';
  $('#game-hud').hidden = mode !== 'test';
  $('#test-controls').hidden = mode !== 'test';
  $('#demo-info').hidden = !demoRuntime;
  document.querySelectorAll('[data-part]').forEach(el => el.classList.toggle('active', el.dataset.part === placingId));
}
function renderParts() {
  const normalized = query.toLowerCase().replace(/[ ×x*]/g, '');
  const matches = PARTS.filter(p => (category === 'all' || p.category === category) && `${p.name}${p.id}`.toLowerCase().replace(/[ ×x*]/g, '').includes(normalized));
  $('#parts-list').innerHTML = matches.map(p => `<button class="part-card ${placingId === p.id ? 'active' : ''}" data-part="${p.id}" aria-label="取用${escape(p.name)}" title="${escape(p.description)}"><div class="part-image">${thumbnails.has(p.id) ? `<img src="${thumbnails.get(p.id)}" alt="" draggable="false">` : `<span class="part-placeholder">${icon('cube', 35)}</span>`}<span class="part-add">${icon('plus', 14)}</span></div><span class="part-name">${escape(p.name)}</span><span class="part-size">${+p.width.toFixed(1)} × ${+p.depth.toFixed(1)} · ${escape(p.ldrawId??p.id)}</span></button>`).join('');
  $('#no-results').hidden = !!matches.length;
}
function renderInspector() {
  const item = doc.parts.find(p => p.id === selectedId);
  const panel = $('#inspector');
  panel.hidden = !item || !!placingId || mode !== 'build' || !!demoRuntime;
  if (!item || placingId || mode !== 'build' || demoRuntime) return;
  const def = getPart(item.partId);
  const links = getConnections(doc.parts).filter(c => c.a === item.id || c.b === item.id);
  panel.innerHTML = `<div class="inspector-header"><span>当前零件 · ${escape(def.ldrawId ?? def.id)}</span><button id="close-inspector" class="small-icon" aria-label="取消选择">${icon('close', 15)}</button></div><h2>${escape(def.name)}</h2><p>${escape(def.description)}</p><div class="inspector-meta"><span>${def.width.toFixed(1)} × ${def.depth.toFixed(1)} 格</span><span>${links.length} 处固定连接</span></div><div class="inspector-section"><label>位置 <span>以凸点为单位</span></label><div class="position-fields">${[['x','X',.5],['y','高度',.4],['z','Z',.5]].map(([key,label,step]) => `<label><span>${label}</span><input type="number" data-position="${key}" aria-label="${label}位置" value="${+item[key].toFixed(2)}" step="${step}" min="${key === 'y' ? 0 : -200}" max="200"></label>`).join('')}</div></div><div class="inspector-section rotation-row"><span>绕 ${rotateAxis.toUpperCase()} 轴旋转</span><button id="inspector-rotate" class="button small">${icon('rotate', 15)}90°</button></div><div class="inspector-section module-section"><label for="module-role">挂载游戏模块</label><select id="module-role"><option value="">结构零件</option>${Object.entries(MODULE_ROLES).map(([type,role])=>`<option value="${type}" ${item.function?.type===type?'selected':''}>${role.name}</option>`).join('')}</select>${item.function?`<label class="module-power">${item.function.type==='battery'?'容量':'动力'}<input id="module-power" aria-label="模块参数" type="number" min="1" max="10000" value="${item.function.type==='battery'?(item.function.capacity??100):(item.function.power??MODULE_ROLES[item.function.type].power)}"></label>`:''}<p>电池通过连接供能。模块参数用于游戏试车。</p></div><div class="inspector-actions"><button id="inspector-move" class="button small">${icon('move', 15)}移动</button><button id="inspector-copy" class="button small">${icon('copy', 15)}复制</button><button id="inspector-delete" class="button small danger" aria-label="删除选中零件">${icon('trash', 15)}</button></div>`;
  $('#close-inspector').onclick = () => select(null);
  $('#inspector-rotate').onclick = rotate;
  $('#inspector-move').onclick = move;
  $('#inspector-copy').onclick = duplicate;
  $('#inspector-delete').onclick = removeSelected;
  const component=getComponentIds(doc,item.id);
  if(component.size>1){
    panel.querySelector('.inspector-meta').insertAdjacentHTML('afterend',`<button id="inspector-move-component" class="button small component-action">${icon('layers',16)}移动整个组件 · ${component.size} 件</button>`);
    $('#inspector-move-component').onclick=moveComponent;
  }
  if(analyzeSupport(doc.parts,doc.joints).unsupportedIds.has(item.id)){
    panel.querySelector('.inspector-meta').insertAdjacentHTML('afterend','<button id="ground-selection" class="button small ground-selection">将悬空组件放回地面</button>');
    $('#ground-selection').onclick=()=>{try{if(changed(groundComponent(doc,item.id),'组件已放回地面'))scene?.focus();}catch(error){toast(error.message,true);}};
  }
  panel.querySelector('.position-fields').insertAdjacentHTML('afterend', `<div class="nudge-heading">位置微调 <span>方向键 · Shift 精调</span></div><div class="nudge-pad" role="group" aria-label="位置微调">${NUDGES.map(([key,label])=>`<button data-nudge="${key}" title="${label}，按住 Shift 精调" aria-label="${label}微调">${label}</button>`).join('')}</div>`);
  panel.querySelectorAll('[data-nudge]').forEach(button=>button.onclick=event=>nudge(button.dataset.nudge,event.shiftKey));
  $('#module-role').onchange = event => {
    const next = { ...item }; if (event.target.value) next.function = { type: event.target.value }; else delete next.function;
    changed({ ...doc, parts: doc.parts.map(p => p.id === item.id ? next : p) }, '模块已更新');
  };
  if ($('#module-power')) $('#module-power').onchange = event => {
    const value = Number(event.target.value); if (!Number.isFinite(value) || value < 1 || value > 10000) { toast('请输入 1–10000 的模块参数', true); renderInspector(); return; }
    const next = { ...item, function: { ...item.function, [item.function.type === 'battery' ? 'capacity' : 'power']: value } };
    changed({ ...doc, parts: doc.parts.map(p=>p.id===item.id?next:p) }, '模块参数已更新');
  };
  panel.querySelectorAll('[data-position]').forEach(input => input.addEventListener('change', () => {
    if(!canEdit())return;
    if(!input.value.trim()){toast('请输入有效坐标。',true);renderInspector();return;}
    const value = Number(input.value);
    const next = { ...item, [input.dataset.position]: value };
    if (!Number.isFinite(value) || !canEditInstance(next, doc.parts, item.id)) {
      toast('这个位置有重叠、穿地或超出了搭建范围。', true); renderInspector(); return;
    }
    if(!changed({ ...doc, parts: doc.parts.map(p => p.id === item.id ? next : p) }, '位置已更新'))renderInspector();
  }));
}
function select(id) {
  selectedId = id;
  statusMessage = '';
  const item = doc.parts.find(p => p.id === id);
  if (item) { color = item.color; updatePalette(); }
  scene?.select(id);
  renderInspector(); renderMode();
  if (mode === 'joints') {
    if (jointDraft && id && jointPickTarget) { jointDraft[jointPickTarget] = id; jointPickTarget = null; }
    renderJointPanel();
  }
}
function beginPlace(partId, options = {}) {
  if (!assetsReady) return;
  if (mode !== 'build' || demoRuntime) setMode('build');
  endPlacement();
  previewId=crypto.randomUUID();placementReason='';
  placementSource = options.partId ? clone(options) : null;
  movingComponentIds=options.componentIds?new Set(options.componentIds):null;
  if(placementSource){delete placementSource.componentIds;delete placementSource.movingId;}
  placementBaseHeight=placementSource?Math.max(0,getBounds(placementSource,true).minY):0;
  scene?.setPlacementPlane(placementBaseHeight);
  placingId = partId;
  movingId = options.movingId ?? null;
  rotation = options.rotation ?? 0;
  rotationX = options.rotationX ?? 0; rotationZ = options.rotationZ ?? 0; placementQuaternion = options.quaternion ? [...options.quaternion] : null; placementLift = 0;
  if (options.color) { color = options.color; updatePalette(); }
  selectedId = options.movingId ?? null;
  scene?.select(null);
  scene?.setHidden(movingComponentIds?[...movingComponentIds]:movingId);
  renderInspector(); renderMode();
  scene?.refreshPointer();
}
function endPlacement() {
  placingId = null; movingId = null;movingComponentIds=null;candidate = null; placementSource = null;placementReason='';
  scene?.showGhost(null);
  scene?.setHidden(null);
  scene?.setPlacementPlane(0);
  renderInspector(); renderMode();
}
function hover(context) {
  if (!placingId || mode !== 'build') return;
  const useHit = !!context.hitPart;
  const pointArray = useHit ? context.point : context.placementPoint;
  if (!pointArray) {
    candidate = null; validCandidate = false; scene?.showGhost(null);
    placementReason='当前高度不在视野内，请调整相机或降低放置高度';
    $('#placement-status').textContent = placementReason;
    return;
  }
  const colliders=movingComponentIds?doc.parts.filter(p=>!movingComponentIds.has(p.id)):doc.parts;
  const position = snapPlacement({ partId: placingId, rotation, rotationX, rotationZ, quaternion: placementQuaternion ?? undefined, normal: context.normal, point: { x: pointArray[0], y: pointArray[1], z: pointArray[2] }, hitPart: useHit ? context.hitPart : undefined, snap: snapping,ignoreId:movingId }, colliders);
  candidate = { ...(placementSource ?? {}), ...position, id: movingId ?? previewId, partId: placingId, rotation, rotationX, rotationZ, color, ...(placementQuaternion ? {quaternion:placementQuaternion} : {}),allowOverlap:false };
  delete candidate.movingId;
  if(useHit)candidate.y+=placementLift;
  else candidate.y+=pointArray[1]-getBounds(candidate,true).minY;
  const proposed=placementDocument(candidate);
  const check=checkBuildChange(doc,proposed);
  validCandidate = check.valid;placementReason=check.reason;
  scene?.showGhosts(movingComponentIds?proposed.parts.filter(p=>movingComponentIds.has(p.id)):[candidate],validCandidate);
  const contacts=validCandidate?colliders.filter(p=>p.id!==movingId).reduce((n,p)=>n+getConnections([p,candidate]).length,0):0;
  $('#placement-status').textContent = validCandidate ? `${contacts?`连接 ${contacts} 件`:getBounds(candidate,true).minY<1e-5?'地面支撑':'表面承托'} · ${candidate.x.toFixed(1)}, ${candidate.y.toFixed(1)}, ${candidate.z.toFixed(1)}` : placementReason;
  $('#placement-banner').classList.toggle('invalid', !validCandidate);
}
function placementDocument(placed) {
  if(movingComponentIds)return translateComponent(doc,movingComponentIds,['x','y','z'].map(axis=>placed[axis]-placementSource[axis]));
  return {...doc,parts:movingId?doc.parts.map(p=>p.id===movingId?placed:p):[...doc.parts,placed]};
}
function canvasClick(context) {
  if (demoRuntime || mode === 'test') return;
  if (mode === 'joints') { select(context.hitPart?.id ?? null); return; }
  if (!placingId) { select(context.hitPart?.id ?? null); return; }
  hover(context);
  if (!validCandidate || !candidate) { toast(placementReason||'此处无法放置，请对准连接面或有支撑的空位。', true); return; }
  if (doc.parts.length >= 1000 && !movingId) { toast('此作品已达到 1000 件的存档上限。', true); return; }
  const prior = doc.parts.find(p => p.id === movingId);
  const placed = { ...(prior ?? {}), ...candidate, id: movingId ?? crypto.randomUUID() };
  const wasMoving = !!movingId;
  if(!changed(placementDocument(placed),movingComponentIds?'整个组件已移动':`${wasMoving ? '已移动' : '已添加'} ${getPart(placingId).name}`))return;
  if (wasMoving) { endPlacement(); select(placed.id); }
  else scene?.refreshPointer();
}
function rotate() {
  if(!canEdit())return;
  if(movingComponentIds){toast('组件移动时保留朝向。放下后可选择零件旋转。');return;}
  if (placingId) {
    const orientation=rotateOrientation({partId:placingId,x:0,y:0,z:0,rotation,rotationX,rotationZ,...(placementQuaternion?{quaternion:placementQuaternion}:{})},rotateAxis);
    rotation=orientation.rotation;rotationX=orientation.rotationX;rotationZ=orientation.rotationZ;placementQuaternion=orientation.quaternion;
    scene?.refreshPointer(); renderMode(); return;
  }
  const item = doc.parts.find(p => p.id === selectedId);
  if (!item) return;
  const next=rotateInstance(item,rotateAxis);
  if (!canEditInstance(next, doc.parts, item.id)) { toast('旋转后会重叠，请先移动到有空间的位置。', true); return; }
  changed({ ...doc, parts: doc.parts.map(p => p.id === item.id ? next : p) }, '已旋转 90°');
}
function move() {
  if(!canEdit())return;
  const item = doc.parts.find(p => p.id === selectedId);
  if (item) beginPlace(item.partId, { ...item, movingId: item.id });
}
function moveComponent() {
  if(!canEdit())return;
  const item=doc.parts.find(p=>p.id===selectedId);if(!item)return;
  const ids=getComponentIds(doc,item.id);
  beginPlace(item.partId,{...item,movingId:item.id,...(ids.size>1?{componentIds:[...ids]}:{})});
}
function duplicate() {
  if(!canEdit())return;
  const item = doc.parts.find(p => p.id === selectedId);
  if (item) beginPlace(item.partId, { ...item });
}
function canEdit(){return mode==='build'&&!demoRuntime&&assetsReady;}
function nudge(key, fine = false) {
  if(!canEdit()||placingId)return;
  const item=doc.parts.find(p=>p.id===selectedId), entry=NUDGES.find(n=>n[0]===key);
  if(!item||!entry)return;
  const [, ,axis,sign]=entry, step=fine ? 0.1 : axis==='y' ? 0.4 : 0.5;
  const next={...item,[axis]:+(item[axis]+sign*step).toFixed(6)};
  if(!canEditInstance(next,doc.parts,item.id)){toast('这个方向没有空位，或会穿过地面。',true);return;}
  changed({...doc,parts:doc.parts.map(p=>p.id===item.id?next:p)},`沿 ${axis.toUpperCase()} ${sign>0?'+':'−'}${step} 格`);
}
function removeSelected() {
  if(!canEdit())return;
  if (!selectedId || placingId) return;
  const joints=doc.joints.filter(j=>j.parentPartId!==selectedId&&j.childPartId!==selectedId), ids=new Set(joints.map(j=>j.id));
  changed({ ...doc, parts: doc.parts.filter(p => p.id !== selectedId), joints, poses:doc.poses.map(p=>({...p,angles:Object.fromEntries(Object.entries(p.angles).filter(([id])=>ids.has(id)))})) }, '零件已拆下，其余零件保留');
}
function undo() {
  if(demoRuntime)return;
  if (!undoStack.length) return;
  if(mode!=='build'||demoRuntime)setMode('build');
  endPlacement(); redoStack.push(clone(doc)); doc = undoStack.pop(); selectedId = null; statusMessage = '已撤销'; renderDocument(); save();
}
function redo() {
  if(demoRuntime)return;
  if (!redoStack.length) return;
  if(mode!=='build'||demoRuntime)setMode('build');
  endPlacement(); undoStack.push(clone(doc)); doc = redoStack.pop(); selectedId = null; statusMessage = '已重做'; renderDocument(); save();
}
function updatePalette() {
  document.querySelectorAll('[data-color]').forEach(el => { const active = el.dataset.color === color; el.classList.toggle('active', active); el.setAttribute('aria-pressed', String(active)); });
  $('#color-name').textContent = COLORS.find(c => c.hex.toLowerCase() === color.toLowerCase())?.name ?? '自定义';
}
async function confirm(title, copy) {
  $('#confirm-title').textContent = title;
  $('#confirm-copy').textContent = copy;
  const dialog = $('#confirm-dialog');
  dialog.returnValue = 'cancel';
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
}
async function replaceDocument(next, label) {
  try{next=validateDocument(next);}catch(error){toast(error.message,true);return false;}
  if (doc.parts.length && !await confirm(label, '将替换当前工作台。你可以取消并先导出备份；替换后也可通过撤销找回。')) return false;
  endPlacement(); selectedId = null; preview = 0; poseOverrides = null; jointDraft=null;selectedJointId=null;jointPickTarget=null; if(changed(next, label,{restore:true})){scene?.focus(); toast(label);return true;}return false;
}

function setMode(next) {
  if (next === 'test' && demoRuntime) { toast('先把示例拆成零件，再挂载动力模块试车。'); return; }
  endPlacement(); previewPlaying = false; pressed.clear();
  if (demoRuntime && next === 'build') demoRuntime = null;
  if (mode === 'test') { scene?.resetMotion(); simulation = null; }
  mode = next; selectedId = null; scene?.setJointGizmo(null); scene?.setMode(mode);
  document.body.dataset.mode=mode;
  scene?.setGrid(mode === 'build' && gridVisible);
  if (mode === 'test') { simulation = createPlaytest(doc,{initialPose:preview}); challengeComplete = false; hudClock=0; }
  renderDocument();
  if (mode === 'joints') frameTransformation();
  if (mode === 'test') { updateHUD(); scene?.focus(); }
}
function frameTransformation() {
  if (!scene) return;
  const samples = Array.from({length:11},(_,i)=>i/10);
  scene.focus(samples.map(t=>demoRuntime?demoRuntime.evaluate(t):evaluatePose(doc.parts,doc.joints,t)));
}
function currentAngles() {
  return poseOverrides ?? Object.fromEntries(doc.joints.map(j => [j.id, j.angleA + (j.angleB-j.angleA)*preview]));
}
function applyPreview(checkCollision = true) {
  if (!scene || mode !== 'joints') return;
  if (demoRuntime) scene.setTransforms(demoRuntime.evaluate(preview));
  else {
    try {
      const joints = poseOverrides ? doc.joints.map(j=>({...j,angleA:poseOverrides[j.id]??j.angleA,angleB:poseOverrides[j.id]??j.angleA})) : doc.joints;
      const transforms = evaluatePose(doc.parts,joints,preview); scene.setTransforms(transforms);
      if (checkCollision) {
        const collisions = getPoseCollisions(doc.parts,transforms);
        $('#collision-status').textContent = collisions.length ? `${collisions.length} 处包围盒干涉` : doc.joints.length ? '姿态可预览' : '';
        $('#collision-status').classList.toggle('warning',!!collisions.length);
      }
    } catch(error){ $('#collision-status').textContent=error.message; }
  }
  $('#pose-progress').value=String(Math.round(preview*100)); $('#pose-percent').textContent=`${Math.round(preview*100)}%`;
  $('#preview-play').textContent=previewPlaying?'暂停':'播放变形';
}
function startJointDraft() {
  const first=selectedId??doc.parts[0]?.id??'';
  const part=doc.parts.find(p=>p.id===first);
  jointDraft={id:crypto.randomUUID(),name:`关节 ${doc.joints.length+1}`,parentPartId:first,childPartId:doc.parts.find(p=>p.id!==first)?.id??'',pivot:part?[part.x,part.y+getPart(part.partId).height,part.z]:[0,0,0],axis:'x',min:-180,max:180,angleA:0,angleB:90};
  selectedJointId=null;jointPickTarget=null;renderJointPanel();scene?.setJointGizmo(jointDraft);
}
function renderJointPanel() {
  const panel=$('#joint-panel'); panel.hidden=mode!=='joints'||!!demoRuntime;
  if(panel.hidden)return;
  const savedJoint=doc.joints.find(j=>j.id===selectedJointId);
  if(!jointDraft&&savedJoint)jointDraft=clone(savedJoint);
  const editing=jointDraft, existing=editing&&doc.joints.some(j=>j.id===editing.id);
  const options=selected=>doc.parts.map((p,i)=>`<option value="${escape(p.id)}" ${p.id===selected?'selected':''}>${i+1}. ${escape(getPart(p.partId).name)}</option>`).join('');
  const numberInput=(key,label,value,step=1)=>`<label>${label}<input aria-label="${label}" type="number" data-joint-number="${key}" value="${value}" step="${step}" min="-360" max="360" required></label>`;
  const partField=(key,label)=>`<div class="joint-part-field"><label for="joint-${key}">${label}</label><div class="joint-part-row"><select id="joint-${key}" aria-label="${label}">${options(editing[`${key}PartId`])}</select><button type="button" data-pick-joint="${key}PartId" class="button small ${jointPickTarget===`${key}PartId`?'primary':''}" aria-label="点选${label}">点选</button></div></div>`;
  panel.innerHTML=`<div class="panel-title"><h2>变形机构 <span>${doc.joints.length}</span></h2><button id="new-joint" class="button small" ${doc.parts.length<2?'disabled':''}>＋ 关节</button></div>
    <p class="panel-copy">在两个独立组件之间设置转轴。固定在子组件上的积木会一起运动。</p>
    <div class="joint-list">${doc.joints.map((j,i)=>`<button data-joint="${escape(j.id)}" class="${j.id===selectedJointId?'active':''}"><span>${escape(j.name??`关节 ${i+1}`)}</span><small>${j.axis.toUpperCase()} · ${j.angleA}° → ${j.angleB}°</small></button>`).join('')||'<p class="panel-empty">先搭好两个组件，或打开“折翼练习”。</p>'}</div>
    ${editing?`<form id="joint-form"><label>名称<input id="joint-name" value="${escape(editing.name??'关节')}" maxlength="60"></label>
      ${partField('parent','父组件')}${partField('child','子组件')}
      ${jointPickTarget?`<p class="joint-pick-hint" role="status">请在画面中点击${jointPickTarget==='parentPartId'?'父':'子'}组件。已填参数会保留。</p>`:''}
      <div class="joint-axis"><label>转动轴<select id="joint-axis">${['x','y','z'].map(a=>`<option value="${a}" ${a===editing.axis?'selected':''}>${a.toUpperCase()} 轴</option>`).join('')}</select></label><button type="button" id="pivot-midpoint" class="button small">两件之间</button></div>
      <span class="field-label">轴心位置</span><div class="joint-numbers">${editing.pivot.map((v,i)=>numberInput(`pivot${i}`,['X','高度','Z'][i],+v.toFixed(2),.1)).join('')}</div>
      <div class="joint-numbers">${numberInput('angleA','姿态 A',editing.angleA)}${numberInput('angleB','姿态 B',editing.angleB)}</div>
      <div class="joint-numbers">${numberInput('min','最小角',editing.min)}${numberInput('max','最大角',editing.max)}</div>
      <div class="joint-form-actions"><button class="button small primary" type="submit">保存关节</button><button class="button small" type="button" id="cancel-joint">取消</button>${existing?'<button class="button small danger" type="button" id="delete-joint">删除</button>':''}</div></form>`:''}
    <div class="pose-library"><h3>命名姿态</h3><div class="pose-chips">${doc.poses.map(p=>`<span class="pose-chip"><button data-pose="${escape(p.id)}">${escape(p.name)}</button><button data-delete-pose="${escape(p.id)}" aria-label="删除姿态${escape(p.name)}">${icon('close',12)}</button></span>`).join('')||'<span>记录关节角度，随时回到这个姿态。</span>'}</div><div class="pose-record"><input id="pose-name" placeholder="姿态名称" aria-label="姿态名称" maxlength="60"><button id="record-pose" class="button small" ${!doc.joints.length?'disabled':''}>记录</button></div></div>
    <p class="panel-footnote">收紧限位前请删除超限姿态。销孔精确插接仍待完善，变形干涉提示采用简化包围盒。</p>`;
  $('#new-joint').onclick=startJointDraft;
  panel.querySelectorAll('[data-joint]').forEach(button=>button.onclick=()=>{
    selectedJointId=button.dataset.joint;jointDraft=clone(doc.joints.find(j=>j.id===selectedJointId));jointPickTarget=null;
    renderJointPanel();scene?.setJointGizmo(jointDraft);
  });
  panel.querySelectorAll('[data-pose]').forEach(button=>button.onclick=()=>{previewPlaying=false;poseOverrides=clone(doc.poses.find(p=>p.id===button.dataset.pose).angles);applyPreview();});
  panel.querySelectorAll('[data-delete-pose]').forEach(button=>button.onclick=()=>{poseOverrides=null;changed({...doc,poses:doc.poses.filter(p=>p.id!==button.dataset.deletePose)},'姿态已删除，可撤销');});
  $('#record-pose').onclick=()=>{const name=$('#pose-name').value.trim()||`姿态 ${doc.poses.length+1}`;changed({...doc,poses:[...doc.poses,{id:crypto.randomUUID(),name,angles:currentAngles()}]},'姿态已记录');};
  if(!editing)return;
  const readForm=()=>({...editing,name:$('#joint-name').value.trim()||'关节',parentPartId:$('#joint-parent').value,childPartId:$('#joint-child').value,axis:$('#joint-axis').value,
    pivot:[0,1,2].map(i=>Number(panel.querySelector(`[data-joint-number="pivot${i}"]`).value)),
    ...Object.fromEntries(['angleA','angleB','min','max'].map(key=>[key,Number(panel.querySelector(`[data-joint-number="${key}"]`).value)]))});
  const syncDraft=()=>{jointDraft=readForm();if(jointDraft.pivot.every(Number.isFinite))scene?.setJointGizmo(jointDraft);};
  $('#joint-form').addEventListener('input',syncDraft);$('#joint-form').addEventListener('change',syncDraft);
  panel.querySelectorAll('[data-pick-joint]').forEach(button=>button.onclick=()=>{syncDraft();jointPickTarget=button.dataset.pickJoint;renderJointPanel();});
  $('#pivot-midpoint').onclick=()=>{
    const a=doc.parts.find(p=>p.id===$('#joint-parent').value),b=doc.parts.find(p=>p.id===$('#joint-child').value);
    if(a&&b){[0,1,2].forEach(i=>{const key=['x','y','z'][i];panel.querySelector(`[data-joint-number="pivot${i}"]`).value=((a[key]+b[key])/2).toFixed(2);});syncDraft();}
  };
  $('#joint-form').onsubmit=event=>{
    event.preventDefault();syncDraft();const joint=clone(jointDraft),others=doc.joints.filter(j=>j.id!==joint.id),check=validateJointCreation(doc.parts,others,joint);
    if(!check.valid){toast(check.error,true);return;}
    if(!changed({...doc,joints:[...others,joint]},'关节已保存'))return;
    jointDraft=null;jointPickTarget=null;selectedJointId=joint.id;preview=0;poseOverrides=null;
    renderJointPanel();applyPreview();scene?.setJointGizmo(joint);frameTransformation();
  };
  $('#cancel-joint').onclick=()=>{jointDraft=null;jointPickTarget=null;selectedJointId=null;scene?.setJointGizmo(null);renderJointPanel();};
  if($('#delete-joint'))$('#delete-joint').onclick=()=>{
    const joints=doc.joints.filter(j=>j.id!==editing.id),poses=doc.poses.map(p=>({...p,angles:Object.fromEntries(Object.entries(p.angles).filter(([id])=>id!==editing.id))}));
    if(changed({...doc,joints,poses},'关节已移除')){jointDraft=null;jointPickTarget=null;selectedJointId=null;poseOverrides=null;scene?.setJointGizmo(null);renderJointPanel();}
  };
}
function samplePart(id,partId,x,y,z,color='#515962',extra={}){return{id,partId,x,y,z,rotation:0,rotationX:0,rotationZ:0,color,...extra};}
function hingeExample(){
  return validateDocument({...createDocument(),name:'折翼 · 关节练习',parts:[samplePart('hinge-base','ld_3022',.5,0,.5),samplePart('hinge-wing','ld_3020',3.5,0,.5,'#abb2b8')],joints:[{id:'wing-joint',name:'折叠机翼',parentPartId:'hinge-base',childPartId:'hinge-wing',pivot:[1.5,.4,.5],axis:'z',min:-90,max:90,angleA:0,angleB:85}],poses:[]});
}
function driveExample(){
  return validateDocument({...createDocument(),name:'动力滑板 · 自由改装',parts:[samplePart('deck','ld_3022',.5,0,.5,'#abb2b8'),samplePart('battery','ld_3005',0,.4,0,'#577866',{function:{type:'battery',capacity:160}}),samplePart('thrust1','ld_3062b',1,.4,0,'#dba635',{function:{type:'thruster',power:120}}),samplePart('thrust2','ld_3062b',1,.4,1,'#515962',{function:{type:'thruster',power:120}}),samplePart('cap','ld_3070b',0,1.6,0,'#272c31')],joints:[],poses:[]});
}
async function showDemo(){
  $('#examples-dialog').close();endPlacement();selectedId=null;scene?.select(null);simulation=null;pressed.clear();toast('正在打开变形机甲…');
  try{const data=await loadTransformerDemo();demoRuntime=createDemoRuntime(data);mode='joints';document.body.dataset.mode=mode;preview=0;previewPlaying=false;poseOverrides=null;scene?.resetMotion();scene?.setMode('joints');scene?.setGrid(false);renderDocument();frameTransformation();$('#collision-status').textContent='参考机构研究示例';}
  catch(error){toast(error.message,true);}
}
function updateHUD(){
  if(!simulation)return;
  const state=simulation.state;
  $('#battery-value').textContent=`${Math.round(state.batteryFraction*100)}%`;
  $('#battery-meter').value=state.batteryFraction;
  $('#speed-value').textContent=state.speed.toFixed(1);
  $('#drive-status').textContent=state.status;
  const vehicle=simulation.vehicle;
  $('#vehicle-modules').textContent=`电池 ${vehicle.batteries} · 推进 ${vehicle.thrusters} · 轮组 ${vehicle.wheels} · 伺服 ${vehicle.servos}${vehicle.disconnectedPartIds.length?` · ${vehicle.disconnectedPartIds.length} 件未接入`:''}`;
  const course=scene?.getCourseState();
  if(!course)return;
  const next=course.gates.filter(g=>!g.collected).sort((a,b)=>Math.hypot(a.x-course.vehicle.x,a.z-course.vehicle.z)-Math.hypot(b.x-course.vehicle.x,b.z-course.vehicle.z))[0];
  $('#course-target').textContent=next?`目标 ${next.index+1} · ${Math.hypot(next.x-course.vehicle.x,next.z-course.vehicle.z).toFixed(1)} 格`:'能量环已全部收集';
  const xMin=Math.min(-7,course.vehicle.x-5),zMin=Math.min(-20,course.vehicle.z-5),xMax=Math.max(22,course.vehicle.x+5),zMax=Math.max(12,course.vehicle.z+5);
  $('#course-map').setAttribute('viewBox',`${xMin} ${zMin} ${xMax-xMin} ${zMax-zMin}`);
  $('#course-map').innerHTML=`<path class="map-axis" d="M0 ${zMin}V${zMax}M${xMin} 0H${xMax}"/>${course.gates.map(g=>`<g class="map-gate ${g.collected?'collected':''} ${g.index===next?.index?'target':''}"><circle cx="${g.x}" cy="${g.z}" r="1.2"/><text x="${g.x+1.8}" y="${g.z+.7}">${g.index+1}</text></g>`).join('')}<path class="map-player" d="M0 -1.9 -1.2 1.2 0 .6 1.2 1.2Z" transform="translate(${course.vehicle.x} ${course.vehicle.z}) rotate(${course.vehicle.yaw*180/Math.PI})"/>`;
}
function onFrame(dt){
  if(mode==='test'&&simulation){
    simulation.step(dt,pressed);
    const pose=doc.joints.length?evaluatePose(doc.parts,doc.joints,simulation.state.poseProgress):null;
    const collected=scene?.setMotion(simulation.state,simulation.vehicle.activePartIds,pose)??0;
    scene?.setFunctionState(simulation.state,simulation.vehicle.activePartIds);
    hudClock+=dt;if(hudClock>.1){updateHUD();$('#gate-count').textContent=`${collected} / 5`;hudClock=0;}
    if(collected===5&&!challengeComplete){challengeComplete=true;toast('五个能量环全部收集！按 R 再来一次。');}
    return true;
  }
  if(mode==='joints'&&previewPlaying){preview+=dt*.28*previewDirection;if(preview>=1){preview=1;previewDirection=-1;}else if(preview<=0){preview=0;previewDirection=1;}poseOverrides=null;hudClock+=dt;applyPreview(hudClock>.25);if(hudClock>.25)hudClock=0;return true;}
  return false;
}

$('#parts-list').addEventListener('click', event => {
  const button = event.target.closest('[data-part]');
  if (button) beginPlace(button.dataset.part);
});
document.querySelectorAll('[data-category]').forEach(button => button.onclick = () => {
  category = button.dataset.category;
  document.querySelectorAll('[data-category]').forEach(el => { const active = el === button; el.classList.toggle('active', active); el.setAttribute('aria-pressed', String(active)); });
  renderParts();
});
$('#part-search').oninput = event => { query = event.target.value; renderParts(); };
$('#part-category').onchange=event=>{category=event.target.value;renderParts();};
document.querySelectorAll('[data-color]').forEach(button => button.onclick = () => {
  color = button.dataset.color; updatePalette();
  if (placingId) { scene?.refreshPointer(); return; }
  if (selectedId&&canEdit()) changed({ ...doc, parts: doc.parts.map(p => p.id === selectedId ? { ...p, color } : p) }, '颜色已更新');
});
$('#project-name').onchange = event => { if(demoRuntime)return;const name = event.target.value.trim() || '未命名作品'; if (name !== doc.name) changed({ ...doc, name }, '作品已重命名'); else event.target.value = name; };
$('#save').onclick = () => save(true);
$('#download-recovery').onclick=()=>{if(recoveryRaw!==null)downloadText(recoveryRaw,'积木工坊-旧草稿原文.recovery.json');};
$('#dismiss-recovery').onclick=()=>$('#recovery-notice').hidden=true;
$('#new-project').onclick = () => {setMode('build');replaceDocument(createDocument(), '新建空白作品');};
$('#example').onclick = () => $('#examples-dialog').showModal();
$('#examples-close').onclick=()=>$('#examples-dialog').close();
$('#empty-example').onclick = showDemo;
$('#empty-drive').onclick = async()=>{if(await replaceDocument(driveExample(),'打开动力滑板'))setMode('test');};
$('#load-transformer').onclick=showDemo;
$('#load-hinge').onclick=async()=>{$('#examples-dialog').close();if(await replaceDocument(hingeExample(),'打开折翼练习')){setMode('joints');selectedJointId=doc.joints[0]?.id;renderJointPanel();frameTransformation();}};
$('#load-drive').onclick=async()=>{$('#examples-dialog').close();if(await replaceDocument(driveExample(),'打开动力滑板'))setMode('test');};
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>setMode(button.dataset.mode));
$('#rotation-axis').onchange=event=>{rotateAxis=event.target.value;renderInspector();renderMode();};
$('#pose-progress').oninput=event=>{previewPlaying=false;preview=Number(event.target.value)/100;poseOverrides=null;applyPreview();};
$('#preview-play').onclick=()=>{if(!demoRuntime&&!doc.joints.length){toast('先创建关节或打开折翼练习');return;}previewPlaying=!previewPlaying;applyPreview();};
$('#demo-close').onclick=()=>{demoRuntime=null;setMode('build');scene?.focus();};
$('#demo-import').onclick=async()=>{if(!demoRuntime)return;const next={...createDocument(),name:'机械机甲 · 自由拆搭',parts:clone(demoRuntime.parts)};if(await replaceDocument(next,'将示例零件放入工作台'))setMode('build');};
$('#reset-drive').onclick=()=>{scene?.resetMotion();simulation?.reset();challengeComplete=false;$('#gate-count').textContent='0 / 5';scene?.focus();updateHUD();};
$('#transform-drive').onclick=()=>{if(!simulation?.vehicle.servos){toast('在结构零件上挂载伺服模块，并连接电池与关节。');return;}simulation.setPoseTarget(simulation.state.poseTarget>.5?0:1);};
let followCamera=true;$('#follow-toggle').onclick=()=>{followCamera=!followCamera;scene?.setFollow(followCamera);$('#follow-toggle').setAttribute('aria-pressed',String(followCamera));$('#follow-toggle').textContent=followCamera?'跟随视角':'自由视角';};
document.querySelectorAll('[data-drive-key]').forEach(button=>{button.onpointerdown=event=>{button.setPointerCapture(event.pointerId);pressed.add(button.dataset.driveKey);};button.onpointerup=button.onpointercancel=()=>pressed.delete(button.dataset.driveKey);});
$('#cancel-placement').onclick = endPlacement;
$('#select-tool').onclick = endPlacement;
$('#rotate-tool').onclick = rotate;
$('#move-tool').onclick = move;
$('#duplicate-tool').onclick = duplicate;
$('#delete-tool').onclick = removeSelected;
$('#undo-tool').onclick = undo;
$('#redo-tool').onclick = redo;
$('#snap-toggle').onclick = () => { snapping = !snapping; $('#snap-toggle').classList.toggle('active', snapping); $('#snap-toggle').setAttribute('aria-pressed', String(snapping)); scene?.refreshPointer(); };
$('#grid-toggle').onclick = () => { gridVisible = !gridVisible; $('#grid-toggle').classList.toggle('active', gridVisible); $('#grid-toggle').setAttribute('aria-pressed', String(gridVisible)); scene?.setGrid(gridVisible); };
$('#material-toggle').classList.toggle('active',material==='glass');
$('#material-toggle').setAttribute('aria-pressed',String(material==='glass'));
$('#material-toggle').onclick=()=>{
  material=material==='glass'?'solid':'glass';document.body.dataset.material=material;
  $('#material-toggle').classList.toggle('active',material==='glass');$('#material-toggle').setAttribute('aria-pressed',String(material==='glass'));
  try{localStorage.setItem('brick-workshop-material',material);}catch{}
};
document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => {
  scene?.view(button.dataset.view);
  document.querySelectorAll('[data-view]').forEach(el => { el.classList.toggle('active', el === button); el.setAttribute('aria-pressed', String(el === button)); });
});
$('#focus').onclick = () => scene?.focus();
let modulesVisible=true;
$('#module-visibility').onclick=()=>{modulesVisible=!modulesVisible;scene?.setModuleVisibility(modulesVisible);$('#module-visibility').setAttribute('aria-pressed',String(modulesVisible));};
$('#help').onclick = () => $('#help-dialog').showModal();
$('#import').onclick = () => $('#file-input').click();
$('#file-input').onchange = async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('文件过大，请选择小于 2MB 的作品文件。');
    const next = validateDocument(JSON.parse(await file.text()));
    if(await replaceDocument(next, '导入作品'))setMode('build');
  } catch (error) { toast(`无法导入：${error instanceof SyntaxError ? '文件不是有效的 JSON。' : error.message}`, true); }
  event.target.value = '';
};
$('#export').onclick = () => {
  downloadText(serializeDocument(doc),`${doc.name.replace(/[<>:"/\\|?*]/g, '_')}.brick.json`);
  toast('作品文件已导出');
};
window.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, select') || document.querySelector('dialog[open]')) return;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if(demoRuntime){
    if(key==='escape')setMode('build');
    else if(key==='f'&&!mod)scene?.focus();
    else if(key==='t'&&!mod)$('#preview-play').click();
    if(['delete','backspace'].includes(key)||(mod&&['z','y','d','s'].includes(key)))event.preventDefault();
    return;
  }
  if(mode==='test'){
    if(event.ctrlKey||event.metaKey){if(event.code==='KeyS'){event.preventDefault();save(true);}return;}
    if(['KeyW','KeyA','KeyS','KeyD','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code)){event.preventDefault();pressed.add(event.code);}
    if(event.code==='KeyR'){$('#reset-drive').click();event.preventDefault();}
    if(event.code==='KeyT'&&!event.repeat){$('#transform-drive').click();event.preventDefault();}
    if(event.code==='Escape')setMode('build');return;
  }
  if (mod && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
  else if (mod && key === 'y') { event.preventDefault(); redo(); }
  else if (mod && key === 's') { event.preventDefault(); save(true); }
  else if (mod && key === 'd') { event.preventDefault(); duplicate(); }
  else if (key === 'escape' || key === 'v') { endPlacement(); select(null); }
  else if (key === 'r' && !mod && mode==='build') { event.preventDefault(); rotate(); }
  else if(key==='t'&&!mod&&mode==='joints'){$('#preview-play').click();}
  else if((key==='pageup'||key==='pagedown')&&placingId){event.preventDefault();placementLift+=key==='pageup'?.4:-.4;scene?.setPlacementPlane(Math.max(0,placementBaseHeight+placementLift));scene?.refreshPointer();}
  else if(!mod&&selectedId&&NUDGES.some(n=>n[0]===event.code)&&mode==='build'){event.preventDefault();nudge(event.code,event.shiftKey);}
  else if (key === 'delete' || key === 'backspace') { event.preventDefault(); removeSelected(); }
  else if (key === 'f' && !mod) { event.preventDefault(); scene?.focus(); }
});
window.addEventListener('keyup',event=>pressed.delete(event.code));
window.addEventListener('blur',()=>pressed.clear());
window.addEventListener('beforeunload', () => { if (draftDirty) save(); });

renderParts();
loadPartAssets(message=>$('#loading-label').textContent=message).then(async()=>{
  if(doc.parts.some(p=>['ld_43722','ld_43723'].includes(p.partId)))await loadTransformerDemo();
  assetsReady=true;
  scene = createWorkshopScene($('#scene'), { onHover: hover, onClick: canvasClick, onFrame, onLeave: () => { candidate = null; validCandidate = false; } });
  $('#loading-assets').hidden=true;
  renderDocument();
  if (doc.parts.length) scene.focus();
  requestAnimationFrame(() => {
    try { thumbnails = createThumbnails(PARTS); renderParts(); }
    catch { toast('缩略图暂时无法显示，仍可按名称取件。', true); }
  });
}).catch(error=>{
  $('#loading-assets').hidden=true;
  $('#scene-error').hidden = false;
  $('#scene-error-detail').textContent = error.message;
  renderDocument();
});
if (startupError) toast(startupError, true);

// Read-only diagnostics make browser QA inspect real state without altering the editor.
Object.defineProperty(window, '__workshop', { value: Object.freeze({
  getDocument: () => clone(doc),
  getState: () => ({ selectedId, placingId, movingId, movingComponentIds:movingComponentIds?[...movingComponentIds]:null,rotation, color, snapping, mode,preview,demo:!!demoRuntime,assetsReady,vehicle:simulation?clone(simulation.state):null,candidate: candidate && clone(candidate), validCandidate, undo: undoStack.length, redo: redoStack.length }),
  getStats: () => getAssemblyStats(doc.parts),
  getSupport: () => {const support=analyzeSupport(doc.parts,doc.joints);return {supportedIds:[...support.supportedIds],unsupportedIds:[...support.unsupportedIds]};},
  project: (x, y, z) => scene?.project(x, y, z),
}) });

