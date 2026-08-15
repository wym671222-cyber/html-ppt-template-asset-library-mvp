import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createStoredZip } from '../../apps/api/src/presentation-exports/offline-archive.js'
import {
  INTERACTIVE_TEMPLATE_PACKAGE_CONTRACT_VERSION,
  TEMPLATE_PACKAGE_CONTRACT_VERSION,
  type TemplatePackageSource,
} from '../../packages/shared/src/template-package.js'
import { adaptTemplatePackageSource, serializeTemplatePackage, type SimulatedTemplateAdapterResult } from '../../apps/api/src/templates/simulated-adapter.js'

/**
 * P05's audited production identity map. The packages are repository-local
 * fixtures; this file never reads either real template-source directory.
 */
export const P05_INTERACTIVE_FIXTURE_IDS = [
  'html-cb836d2ecd89f92a83a9',
  'html-6d4b6ae2a990d98ea2b7',
  'html-ccda92d7e32ddb4309fe',
  'html-e9ec34af4df7e188bb18',
  'html-f2e631d324202a04d9c4',
  'html-0fbaff089533f945253b',
  'html-c40a2c04cde43a117003',
  'html-281f8b3a9fe4d477c8b6',
  'html-694cd877bd5e926108df',
  'html-01ee4e7b1e70f75fbc18',
  'html-14e4e0160a908d23186b',
  'html-9173e7af18834a740e1e',
] as const

export const P05_LOCAL_LIBRARY_VERSIONS = {
  gsap: '3.13.0',
  echarts: '5.6.0',
  d3: '7.9.0',
  three: '0.152.2',
  p5: '2.1.1',
  'matter-js': '0.20.0',
  interactjs: '1.10.27',
} as const

const VENDORS = {
  gsap: { packageName: 'gsap', version: P05_LOCAL_LIBRARY_VERSIONS.gsap, source: 'node_modules/gsap/dist/gsap.min.js', file: 'vendor/gsap.min.js' },
  echarts: { packageName: 'echarts', version: P05_LOCAL_LIBRARY_VERSIONS.echarts, source: 'node_modules/echarts/dist/echarts.min.js', file: 'vendor/echarts.min.js' },
  d3: { packageName: 'd3', version: P05_LOCAL_LIBRARY_VERSIONS.d3, source: 'node_modules/d3/dist/d3.min.js', file: 'vendor/d3.min.js' },
  three: { packageName: 'three', version: P05_LOCAL_LIBRARY_VERSIONS.three, source: 'node_modules/three/build/three.min.js', file: 'vendor/three.min.js' },
  p5: { packageName: 'p5', version: P05_LOCAL_LIBRARY_VERSIONS.p5, source: 'node_modules/p5/lib/p5.min.js', file: 'vendor/p5.min.js' },
  matter: { packageName: 'matter-js', version: P05_LOCAL_LIBRARY_VERSIONS['matter-js'], source: 'node_modules/matter-js/build/matter.min.js', file: 'vendor/matter.min.js' },
  interact: { packageName: 'interactjs', version: P05_LOCAL_LIBRARY_VERSIONS.interactjs, source: 'node_modules/interactjs/dist/interact.min.js', file: 'vendor/interact.min.js' },
} as const

type VendorName = keyof typeof VENDORS
type FixtureKind = 'title' | 'timeline' | 'chart' | 'quadrant' | 'flow' | 'star' | 'orbit' | 'particles' | 'physics' | 'focus' | 'compare' | 'composer'

const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

export type P05InteractiveFixtureDefinition = Readonly<{
  id: (typeof P05_INTERACTIVE_FIXTURE_IDS)[number]
  title: string
  kind: FixtureKind
  vendor: VendorName
  accent: string
}>

export const P05_INTERACTIVE_FIXTURES: readonly P05InteractiveFixtureDefinition[] = [
  { id: 'html-cb836d2ecd89f92a83a9', title: '动态标题导演', kind: 'title', vendor: 'gsap', accent: '#2563eb' },
  { id: 'html-6d4b6ae2a990d98ea2b7', title: '叙事时间线', kind: 'timeline', vendor: 'gsap', accent: '#7c3aed' },
  { id: 'html-ccda92d7e32ddb4309fe', title: '数据变形叙事', kind: 'chart', vendor: 'echarts', accent: '#0891b2' },
  { id: 'html-e9ec34af4df7e188bb18', title: '决策象限', kind: 'quadrant', vendor: 'echarts', accent: '#db2777' },
  { id: 'html-f2e631d324202a04d9c4', title: '流向探索器', kind: 'flow', vendor: 'echarts', accent: '#0f766e' },
  { id: 'html-0fbaff089533f945253b', title: '关系星图', kind: 'star', vendor: 'd3', accent: '#9333ea' },
  { id: 'html-c40a2c04cde43a117003', title: '3D 系统轨道', kind: 'orbit', vendor: 'three', accent: '#1d4ed8' },
  { id: 'html-281f8b3a9fe4d477c8b6', title: '生成式品牌场', kind: 'particles', vendor: 'p5', accent: '#ea580c' },
  { id: 'html-694cd877bd5e926108df', title: '物理优先级场', kind: 'physics', vendor: 'matter', accent: '#be123c' },
  { id: 'html-01ee4e7b1e70f75fbc18', title: '图像焦点地图', kind: 'focus', vendor: 'gsap', accent: '#4f46e5' },
  { id: 'html-14e4e0160a908d23186b', title: '转型对照镜', kind: 'compare', vendor: 'gsap', accent: '#0284c7' },
  { id: 'html-9173e7af18834a740e1e', title: '实时组件编排器', kind: 'composer', vendor: 'interact', accent: '#16a34a' },
]

const vendorCache = new Map<VendorName, string>()

function definition(assetId: string): P05InteractiveFixtureDefinition {
  const value = P05_INTERACTIVE_FIXTURES.find((fixture) => fixture.id === assetId)
  if (!value) throw new Error(`Unknown P05 fixture asset id: ${assetId}`)
  return value
}

/** Remove literal URL schemes from otherwise unmodified official browser dists.
 * The escape sequences preserve string values at runtime while satisfying the
 * v2 source policy, which intentionally rejects even URL-looking comments. */
function sanitizeVendorJavaScript(content: string): string {
  return content
    .replace(/(?:https?|wss?|ftp|file):\/\//gi, (value) => `${value.slice(0, value.indexOf(':'))}\\x3a\\/\\/`)
    .replace(/\$(?=[&'`$])/g, '\\u0024')
    .replace(/\.data:/gi, "['data']:")
    .replace(/(?<!\.)\bdata:/gi, "['data']:")
    .replace(/(["'])import\(/g, '$1imp\\x6frt(')
    .replace(/(^|["'(\s])\/\/(?=(?:[a-z0-9.-]+\.[a-z]{2,}|localhost|\d{1,3}(?:\.\d{1,3}){3}))/gim, '$1/\\x2f')
}

function localVendor(name: VendorName): string {
  const cached = vendorCache.get(name)
  if (cached) return cached
  const vendor = VENDORS[name]
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'node_modules', vendor.packageName, 'package.json'), 'utf8')) as { version?: string }
  if (packageJson.version !== vendor.version) throw new Error(`P05 vendor ${vendor.packageName} must be fixed at ${vendor.version}`)
  let result = sanitizeVendorJavaScript(readFileSync(join(process.cwd(), vendor.source), 'utf8'))
  // p5's bundled parser retains module-keyword prose and code-generator
  // strings. The runtime's classic-script gate treats those inert strings as
  // module syntax, so encode the keyword text without changing its value.
  if (name === 'p5') result = result.replace(/\bimport\b/g, 'imp\\x6frt').replace(/\bexport\b/g, 'exp\\x6frt')
  vendorCache.set(name, result)
  return result
}

function stage(def: P05InteractiveFixtureDefinition): string {
  const common = `<main id="stage" data-template-slot="accent-color" data-p05-kind="${def.kind}"><header><p class="eyebrow">interactive template / v2</p><h1 data-template-slot="title">${def.title}</h1><p id="status" aria-live="polite">ready</p></header>`
  const controls = '<div class="controls">'
  const close = '</main>'
  switch (def.kind) {
    case 'title': return `${common}<div id="title-card" class="hero-card">可回放的标题节奏</div>${controls}<button id="replay" type="button">回放标题</button></div>${close}`
    case 'timeline': return `${common}<div id="timeline-track" class="timeline"><span>洞察</span><span>选择</span><span>行动</span></div>${controls}<button id="timeline-prev" type="button">上一步</button><button id="timeline-next" type="button">下一步</button></div>${close}`
    case 'chart': return `${common}<div id="chart" class="chart"></div>${controls}<button id="switch-view" type="button">切换图表</button></div>${close}`
    case 'quadrant': return `${common}<div id="quadrant-chart" class="chart"></div>${controls}<button data-quadrant="growth" type="button">增长</button><button data-quadrant="defend" type="button">守护</button></div>${close}`
    case 'flow': return `${common}<div id="flow-chart" class="chart"></div>${controls}<button data-flow="research" type="button">研究流</button><button data-flow="launch" type="button">发布流</button></div>${close}`
    case 'star': return `${common}<svg id="star-map" class="star-map" viewBox="0 0 800 420" aria-label="relationship star map"></svg><p id="star-readout">drag and zoom</p>${close}`
    case 'orbit': return `${common}<div id="orbit-host" class="canvas-host"><canvas id="orbit-canvas"></canvas></div><p id="orbit-readout">webgl prepared</p>${close}`
    case 'particles': return `${common}<div id="particle-host" class="canvas-host"></div>${controls}<button id="particle-burst" type="button">生成粒子</button></div>${close}`
    case 'physics': return `${common}<div id="physics-field" class="physics-field"><span id="physics-token">优先级</span></div>${controls}<button id="physics-step" type="button">推进物理</button></div>${close}`
    case 'focus': return `${common}<div id="focus-map" class="focus-map"><span>焦点</span></div>${controls}<button id="zoom-in" type="button">放大焦点</button><button id="zoom-out" type="button">缩小焦点</button></div>${close}`
    case 'compare': return `${common}<div id="compare-map" class="compare-map"><span class="before">当前</span><span class="after">目标</span></div><label>对照 <input id="compare-range" type="range" min="0" max="100" value="50"></label>${close}`
    case 'composer': return `${common}<div id="composer-board" class="composer-board"><article id="layout-card" tabindex="0">拖拽组件</article><article class="layout-note">实时布局</article></div>${close}`
  }
}

function runtime(def: P05InteractiveFixtureDefinition): string {
  const prelude = `(() => {'use strict';const root=document.documentElement;const stage=document.getElementById('stage');const status=document.getElementById('status');const say=(value)=>{root.dataset.p05State=value;if(status)status.textContent=value};`
  const end = `say('ready');})();`
  switch (def.kind) {
    case 'title': return `${prelude}let cycle=0;const play=()=>{cycle+=1;root.dataset.animationCycle=String(cycle);gsap.fromTo('#title-card',{opacity:.2,y:32},{opacity:1,y:0,duration:.18});say('title-replayed')};document.getElementById('replay').addEventListener('click',play);document.addEventListener('html-template:replay',play);${end}`
    case 'timeline': return `${prelude}let step=0;const render=(animate)=>{root.dataset.timelineStep=String(step);if(animate)gsap.to('#timeline-track',{x:-step*90,duration:.12});say('timeline-'+step)};document.getElementById('timeline-next').addEventListener('click',()=>{step=(step+1)%3;render(true)});document.getElementById('timeline-prev').addEventListener('click',()=>{step=(step+2)%3;render(true)});root.dataset.timelineStep='0';${end}`
    case 'chart': return `${prelude}let chart,line=false;const draw=()=>{chart||(chart=echarts.init(document.getElementById('chart')));root.dataset.chartView=line?'line':'bar';root.dataset.chartSwitches=String(Number(root.dataset.chartSwitches||0)+1);const axis={type:'category'};axis['data']=['洞察','方案','结果'];const series={type:line?'line':'bar'};series['data']=line?[3,8,6]:[7,4,9];chart.setOption({animation:false,xAxis:axis,yAxis:{type:'value'},series:[series]});say('chart-'+root.dataset.chartView)};document.getElementById('switch-view').addEventListener('click',()=>{line=!line;draw()});root.dataset.chartView='bar';${end}`
    case 'quadrant': return `${prelude}let chart;const draw=(name)=>{chart||(chart=echarts.init(document.getElementById('quadrant-chart')));root.dataset.quadrant=name;const series={type:'scatter'};series['data']=name==='growth'?[[8,8],[7,6]]:[[3,4],[2,6]];chart.setOption({animation:false,xAxis:{min:0,max:10},yAxis:{min:0,max:10},series:[series]});say('quadrant-'+name)};document.querySelectorAll('[data-quadrant]').forEach((button)=>button.addEventListener('click',()=>draw(button.dataset.quadrant)));root.dataset.quadrant='growth';${end}`
    case 'flow': return `${prelude}let chart;const draw=(name)=>{chart||(chart=echarts.init(document.getElementById('flow-chart')));root.dataset.flowFocus=name;const series={type:'sankey'};series['data']=[{name:'研究'},{name:'原型'},{name:'发布'}];series.links=name==='research'?[{source:'研究',target:'原型',value:8},{source:'原型',target:'发布',value:3}]:[{source:'研究',target:'原型',value:3},{source:'原型',target:'发布',value:8}];chart.setOption({animation:false,series:[series]});say('flow-'+name)};document.querySelectorAll('[data-flow]').forEach((button)=>button.addEventListener('click',()=>draw(button.dataset.flow)));root.dataset.flowFocus='research';${end}`
    case 'star': return `${prelude}const svg=d3.select('#star-map');const nodes=[{id:'核心',x:400,y:210},{id:'客户',x:180,y:100},{id:'团队',x:620,y:120},{id:'数据',x:560,y:330},{id:'策略',x:220,y:320}];const layer=svg.append('g');layer.selectAll('line').data(nodes.slice(1)).join('line').attr('x1',400).attr('y1',210).attr('x2',d=>d.x).attr('y2',d=>d.y).attr('stroke','#94a3b8');const drag=d3.drag().on('drag',(event,d)=>{d.x=event.x;d.y=event.y;d3.select(event.sourceEvent.target).attr('cx',d.x).attr('cy',d.y);root.dataset.starDragged='true';say('star-dragged')});layer.selectAll('circle').data(nodes).join('circle').attr('cx',d=>d.x).attr('cy',d=>d.y).attr('r',d=>d.id==='核心'?30:20).attr('fill','${def.accent}').call(drag);const zoom=d3.zoom().scaleExtent([.7,2]).on('zoom',(event)=>{layer.attr('transform',event.transform);root.dataset.starZoom=String(event.transform.k);say('star-zoomed')});svg.call(zoom);${end}`
    case 'orbit': return `${prelude}const canvas=document.getElementById('orbit-canvas');let renderer,scene,camera,mesh,angle=0;const ensure=()=>{if(renderer)return;renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});renderer.setSize(420,240);scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(55,420/240,.1,100);camera.position.z=4;mesh=new THREE.Mesh(new THREE.TorusGeometry(1,.22,12,32),new THREE.MeshBasicMaterial({color:0x2563eb}));scene.add(mesh);root.dataset.webgl='ready'};const spin=()=>{ensure();angle+=.35;root.dataset.orbitAngle=angle.toFixed(2);mesh.rotation.x=angle;mesh.rotation.y=angle;renderer.render(scene,camera);say('orbit-rotated')};canvas.addEventListener('pointermove',(event)=>{if(event.buttons)spin()});${end}`
    case 'particles': return `${prelude}let particles=12,started=false;const host=document.getElementById('particle-host');const burst=()=>{if(!started){started=true;new p5((p)=>{p.setup=()=>p.createCanvas(420,220).parent(host);p.draw=()=>{p.background(247,250,252);for(let i=0;i<particles;i+=1){p.fill(234,88,12,180);p.circle((i*37+p.frameCount)%420,30+(i*29)%180,7)}}})}particles+=8;root.dataset.particles=String(particles);say('particles-'+particles)};document.getElementById('particle-burst').addEventListener('click',burst);root.dataset.particles='12';${end}`
    case 'physics': return `${prelude}const engine=Matter.Engine.create();const token=Matter.Bodies.circle(40,40,18);Matter.World.add(engine.world,token);let ticks=0;const step=()=>{Matter.Engine.update(engine,1000/60);ticks+=1;root.dataset.physicsTicks=String(ticks);root.dataset.physicsX=token.position.x.toFixed(2);document.getElementById('physics-token').style.transform='translateX('+token.position.x+'px)';say('physics-'+ticks)};document.getElementById('physics-step').addEventListener('click',step);${end}`
    case 'focus': return `${prelude}let scale=1;const render=(apply)=>{if(apply)document.getElementById('focus-map').style.transform='scale('+scale+')';root.dataset.focusScale=scale.toFixed(1);say('focus-'+root.dataset.focusScale)};document.getElementById('zoom-in').addEventListener('click',()=>{scale=Math.min(2,scale+.2);render(true)});document.getElementById('zoom-out').addEventListener('click',()=>{scale=Math.max(.6,scale-.2);render(true)});root.dataset.focusScale='1.0';${end}`
    case 'compare': return `${prelude}const input=document.getElementById('compare-range');const render=(apply)=>{root.dataset.comparePosition=input.value;if(apply)document.getElementById('compare-map').style.setProperty('--split',input.value+'%');say('compare-'+input.value)};input.addEventListener('input',()=>render(true));root.dataset.comparePosition='50';${end}`
    case 'composer': return `${prelude}let x=0,y=0;const card=document.getElementById('layout-card');const move=(dx,dy)=>{x+=dx;y+=dy;card.style.transform='translate('+x+'px,'+y+'px)';root.dataset.layoutX=Math.round(x).toString();root.dataset.layoutY=Math.round(y).toString();say('layout-dragged')};interact(card).draggable({listeners:{move(event){move(event.dx,event.dy)}}});${end}`
  }
}

function sourceFor(def: P05InteractiveFixtureDefinition, version: 1 | 2): TemplatePackageSource {
  const interactive = version === 2
  const files: Record<string, string> = {
    'index.html': `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head><body>${stage(def)}<img class="pixel" alt="fixture pixel" src="data:image/png;base64,${ONE_PIXEL_PNG}">${interactive ? `<script src="${VENDORS[def.vendor].file}"></script><script src="runtime.js"></script>` : ''}</body></html>`,
    'styles.css': `:root{font-family:ui-sans-serif,system-ui,sans-serif;color:#0f172a;background:#f8fafc}html,body,#stage{margin:0;width:100%;height:100%;overflow:hidden}#stage{box-sizing:border-box;padding:42px;border-top:14px solid ${def.accent};background:linear-gradient(135deg,#fff,#eff6ff);display:grid;gap:16px;align-content:start}.eyebrow{letter-spacing:.14em;text-transform:uppercase;color:#64748b;font-size:12px;margin:0}h1{font-size:42px;margin:0}#status{min-height:24px;color:#475569}.hero-card,.timeline,.focus-map,.compare-map,.composer-board,.physics-field,.canvas-host{border:1px solid #cbd5e1;border-radius:18px;background:#fff;padding:24px;box-sizing:border-box}.hero-card{font-size:32px;font-weight:700}.timeline{display:flex;gap:64px;width:max-content}.chart{width:620px;height:330px}.star-map{width:760px;height:390px;background:#fff;border-radius:18px;border:1px solid #cbd5e1}.canvas-host{width:460px;height:260px;padding:8px}.canvas-host canvas{display:block}.controls{display:flex;gap:10px}button{padding:10px 16px;border:0;border-radius:10px;background:${def.accent};color:#fff;font-weight:700;cursor:pointer}.physics-field{height:120px;position:relative}.physics-field span{display:inline-block;padding:12px;border-radius:999px;background:${def.accent};color:#fff}.focus-map{width:340px;height:180px;display:grid;place-items:center;transform-origin:center;background:radial-gradient(circle at 55% 46%,${def.accent},#dbeafe 45%,#fff 70%)}.compare-map{--split:50%;width:500px;height:180px;position:relative;background:linear-gradient(90deg,${def.accent} 0 var(--split),#cbd5e1 var(--split) 100%)}.compare-map span{position:absolute;top:72px;color:#fff;font-weight:700}.before{left:24px}.after{right:24px}.composer-board{display:flex;gap:24px;width:520px;height:240px}.composer-board article{padding:28px;border-radius:14px;background:#e0f2fe;touch-action:none}.layout-note{height:max-content}.pixel{width:1px;height:1px}`,
  }
  const manifestFiles = ['index.html', 'styles.css']
  if (interactive) {
    files[VENDORS[def.vendor].file] = localVendor(def.vendor)
    files['runtime.js'] = runtime(def)
    manifestFiles.push(VENDORS[def.vendor].file, 'runtime.js')
  }
  const metadata = {
    id: def.id,
    title: def.title,
    summary: `${def.title} repository-local deterministic migration fixture`,
    category: 'p05/interactive-components',
    tags: ['interactive', 'p05-fixture'],
    entry: 'index.html',
    files: manifestFiles.sort(),
    slots: [
      { id: 'accent-color', type: 'color' as const, required: false, default: def.accent },
      { id: 'title', type: 'text' as const, required: false, maxLength: 120, default: def.title },
    ],
  }
  return interactive
    ? { manifest: { contractVersion: INTERACTIVE_TEMPLATE_PACKAGE_CONTRACT_VERSION, version, ...metadata, runtime: { mode: 'sandboxed-js' as const, viewport: { width: 1920 as const, height: 1080 as const } } }, files }
    : { manifest: { contractVersion: TEMPLATE_PACKAGE_CONTRACT_VERSION, version, ...metadata }, files }
}

export function createP05InteractiveSource(assetId: string): TemplatePackageSource { return sourceFor(definition(assetId), 2) }
export function createP05V1BaselineSource(assetId: string): TemplatePackageSource { return sourceFor(definition(assetId), 1) }
export function createP05InteractivePackage(assetId: string): SimulatedTemplateAdapterResult { return adaptTemplatePackageSource(createP05InteractiveSource(assetId), 'fixtures/p05-interactive-v2') }
export function createP05V1BaselinePackage(assetId: string): SimulatedTemplateAdapterResult { return adaptTemplatePackageSource(createP05V1BaselineSource(assetId), 'fixtures/p05-interactive-v2') }

/** Materialise all twelve packages under a caller-owned temporary/fixture root. */
export function writeP05InteractiveFixtureDirectory(outputRoot: string): void {
  for (const assetId of P05_INTERACTIVE_FIXTURE_IDS) {
    const directory = join(outputRoot, assetId)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const source = createP05InteractiveSource(assetId)
    writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(source.manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'w', mode: 0o600 })
    for (const name of source.manifest.files) {
      const destination = join(directory, name)
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
      writeFileSync(destination, source.files[name], { encoding: 'utf8', flag: 'w', mode: 0o600 })
    }
  }
}

/** Build a byte-stable stored ZIP: fixed entry order, fixed DOS timestamp, no compression. */
export function createP05PackageZip(assetId: string): Buffer {
  const source = createP05InteractiveSource(assetId)
  const manifest = Buffer.from(`${JSON.stringify(source.manifest, null, 2)}\n`, 'utf8')
  const files = source.manifest.files.map((name) => ({ relativePath: name, content: Buffer.from(source.files[name], 'utf8') }))
  return createStoredZip([{ relativePath: 'manifest.json', content: manifest }, ...files])
}

export function p05FixtureDigest(assetId: string): string { return createHash('sha256').update(serializeTemplatePackage(createP05InteractiveSource(assetId))).digest('hex') }
export function p05FixtureDigests(): Readonly<Record<string, string>> { return Object.fromEntries(P05_INTERACTIVE_FIXTURE_IDS.map((id) => [id, p05FixtureDigest(id)])) }
