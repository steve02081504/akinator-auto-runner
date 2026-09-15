import { createServer } from 'node:http'

/**
 * 一个最小可用的 akinator 模拟服务器，用于端到端测试。
 *
 * 支持 /game（返回含 session/signature/identifiant 与首题、游戏区块的 HTML）、/answer、（/ws/list.php）、
 * /choice、/exclude、/cancel_answer；`/theme-selection` 返回无游戏区块的选择页，
 * 用于验证「在非游戏页开始时先跳游戏页」。
 * 剧本通过 setScenario 注入：每个剧本项是后续一次 /answer（或 /exclude）的响应。
 *
 * 游戏页（`GET /` 与 `POST /game`）带页面自身的 JS：点击答案 / 候选按钮由页面自己发请求、
 * 自己更新 DOM（等价于 akinator 的页面逻辑），脚本只能靠点击驱动它。`getGamePosts()` 统计
 * `POST /game` 次数，用于断言脚本没有自己另开会话。
 */

/** @type {object[]} */
let scenario = []

/** @type {Map<string, { index: number, step: number, candidates: object[] }>} */
const sessions = new Map()

let counter = 0

/** `POST /game` 的次数（脚本若自己开会话就会增加）。 */
let gamePosts = 0

/** `/choice` 响应的延迟毫秒数（模拟 akinator 的汇报请求，供「等汇报完再开下一局」用例）。 */
let choiceDelayMs = 0

/** 关键请求的时间线：`/choice`（页面自身汇报选择）与 `POST /game`（脚本开下一局）。 */
const timeline = []

/**
 * 读取表单请求体。
 * @param {import('node:http').IncomingMessage} request 请求
 * @returns {Promise<URLSearchParams>} 表单
 */
function readForm(request) {
	return new Promise((resolve) => {
		let body = ''
		request.on('data', (chunk) => {
			body += chunk
		})
		request.on('end', () => resolve(new URLSearchParams(body)))
	})
}

/**
 * 游戏页 HTML：含页面自身的会话（hidden 输入）与 akinator 式按钮 JS，
 * 点击按钮由页面自己发请求并更新 DOM，脚本只能靠点击驱动它。
 * @param {string} sessionId 会话 id
 * @param {string} signature 签名
 * @param {string} identifiant 用户标识
 * @param {number} sid 题库类型
 * @param {boolean} childMode 儿童模式
 * @returns {string} HTML
 */
function gameHtml(sessionId, signature, identifiant, sid, childMode) {
	return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>mock akinator</title>
</head><body>
<div id="game_content">
	<input type="hidden" id="session" value="${sessionId}">
	<input type="hidden" id="signature" value="${signature}">
	<input type="hidden" id="identifiant" value="${identifiant}">
	<input type="hidden" id="sid" value="${sid}">
	<input type="hidden" id="cm" value="${childMode ? 'true' : 'false'}">
	<input type="hidden" id="id_proposition" value="">
	<div id="questionGameBlock">
		<div class="bubble-question"><p class="question-text" id="question-label">Is it a mock question?</p></div>
		<p class="question-number" id="step-info">1</p>
		<ul>${answerListHtml()}</ul>
	</div>
	<div id="proposeGameBlock" style="display:none">
		<p id="p-sub-bubble">I think of</p>
		<span id="name_proposition"></span>
		<span id="description_proposition"></span>
		<div id="img_character"></div>
		<a href="#" id="a_propose_yes" data-id="" onclick="mockChooseProposition(true);return false;">Yes</a>
		<a href="#" id="a_continue_yes" style="display:none" onclick="mockChooseContinue(true);return false;">Yes</a>
		<a href="#" id="a_propose_no" onclick="mockChooseProposition(false);return false;">No</a>
		<a href="#" id="a_continue_no" style="display:none" onclick="mockChooseContinue(false);return false;">No</a>
	</div>
</div>
<script>
${pageScript()}
</script>
</body></html>`
}

/**
 * 游戏页里的五个答案按钮（点击落到页面自身逻辑上）。
 * @returns {string} HTML
 */
function answerListHtml() {
	return [
		['a_yes', 0, 'Yes'],
		['a_no', 1, 'No'],
		['a_dont_know', 2, 'Don\'t know'],
		['a_probably', 3, 'Probably'],
		['a_probaly_not', 4, 'Probably not'],
	].map(([id, index, label]) => `<li><a class="li-game" href="#" id="${id}" data-index="${index}" onclick="mockChooseAnswer(${index});return false;">${label}</a></li>`).join('')
}

/**
 * 游戏页自带的 akinator 式脚本：自己发 /answer、/exclude、/choice 并更新 DOM。
 * `window.__pageClicks` 记录页面自身处理过的点击，供测试断言脚本确实在点按钮。
 * @returns {string} 脚本正文
 */
function pageScript() {
	return `
var mockStep = 0;
var mockProposition = { id: '', name: '', description: '', photo: '' };
window.__pageClicks = [];
try { localStorage.removeItem('game_ended'); } catch (error) {}
function mockSet(id, text) { var el = document.getElementById(id); if (el) el.textContent = text; }
function mockButtons(show) {
	['a_yes', 'a_no', 'a_dont_know', 'a_probably', 'a_probaly_not'].forEach(function (id) {
		var button = document.getElementById(id);
		if (button) button.style.display = show ? '' : 'none';
	});
}
function mockSchedule(callback, delayMs) {
	var start = performance.now();
	function tick(now) {
		if (now - start >= delayMs) callback();
		else window.requestAnimationFrame(tick);
	}
	window.requestAnimationFrame(tick);
}
function mockRender(data) {
	var questionBlock = document.getElementById('questionGameBlock');
	var proposeBlock = document.getElementById('proposeGameBlock');
	var continueYes = document.getElementById('a_continue_yes');
	var continueNo = document.getElementById('a_continue_no');
	var proposeYes = document.getElementById('a_propose_yes');
	var proposeNo = document.getElementById('a_propose_no');
	if (continueYes) continueYes.style.display = 'none';
	if (continueNo) continueNo.style.display = 'none';
	if (proposeYes) proposeYes.style.display = '';
	if (proposeNo) proposeNo.style.display = '';
	if (data && (data.id_proposition || data.id_base_proposition)) {
		try { localStorage.removeItem('game_ended'); } catch (error) {}
		mockProposition = {
			id: String(data.id_proposition || ''),
			name: String(data.name_proposition || ''),
			description: String(data.description_proposition || ''),
			photo: String(data.photo || ''),
		};
		document.getElementById('id_proposition').value = mockProposition.id;
		var yes = document.getElementById('a_propose_yes');
		if (yes) yes.setAttribute('data-id', mockProposition.id);
		if (questionBlock) questionBlock.style.display = 'none';
		if (proposeBlock) proposeBlock.style.display = '';
		mockSet('name_proposition', mockProposition.name);
		mockSet('description_proposition', mockProposition.description);
		var image = document.getElementById('img_character');
		if (image) {
			image.textContent = '';
			if (mockProposition.photo) {
				var photo = document.createElement('img');
				photo.src = mockProposition.photo;
				photo.alt = mockProposition.name;
				image.appendChild(photo);
			}
		}
		return;
	}
	if (questionBlock) questionBlock.style.display = '';
	if (proposeBlock) proposeBlock.style.display = 'none';
	if (data && data.question) {
		try { localStorage.removeItem('game_ended'); } catch (error) {}
		mockProposition = { id: '', name: '', description: '', photo: '' };
		document.getElementById('id_proposition').value = '';
		mockStep = Number(data.step) || 0;
		// 模拟 akinator 切题过渡：先收起旧题（题面空、按钮隐藏），再用 requestAnimationFrame
		// 稍后显示新题（真实 akinator 的过渡靠动画帧驱动，窗口被遮挡时会停摆）。
		// 过渡时长可用 window.__mockTransitionMs 拉长，用来验证脚本不会把过渡态误判为认输。
		mockButtons(false);
		mockSet('question-label', '');
		mockSchedule(function () {
			mockButtons(true);
			mockSet('question-label', String(data.question));
			mockSet('step-info', String(mockStep + 1));
		}, Number(window.__mockTransitionMs) || 200);
		return;
	}
	try { localStorage.setItem('game_ended', 'yes'); } catch (error) {}
	mockButtons(false);
	mockSet('question-label', 'Akinator gave up');
	mockSet('step-info', '');
}
function mockPost(path, params) {
	return fetch(path, {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
		body: new URLSearchParams(params),
	}).then(function (response) { return response.text(); }).then(function (text) {
		try { return JSON.parse(text); } catch (error) { return null; }
	});
}
function mockChooseAnswer(index) {
	var step = mockStep;
	mockStep = mockStep + 1;
	window.__pageClicks.push({ kind: 'answer', index: index });
	mockPost('/answer', {
		step: step,
		progression: 0,
		sid: document.getElementById('sid').value,
		cm: document.getElementById('cm').value,
		answer: index,
		session: document.getElementById('session').value,
		signature: document.getElementById('signature').value,
	}).then(mockRender);
}
function mockChooseProposition(accept) {
	window.__pageClicks.push({ kind: accept ? 'propose_yes' : 'propose_no' });
	if (accept) {
		mockPost('/choice', {
			step: mockStep,
			sid: document.getElementById('sid').value,
			session: document.getElementById('session').value,
			signature: document.getElementById('signature').value,
			identifiant: document.getElementById('identifiant').value,
			pid: mockProposition.id,
			charac_name: mockProposition.name,
			charac_description: mockProposition.description,
			pflag_photo: '',
		});
		mockButtons(false);
		mockSet('question-label', 'Bravo!');
		return;
	}
	if (window.__mockRequireContinueConfirm) {
		// 模拟 akinator 的「继续？」确认：藏起 propose 的是 / 否，换成 continue 的是 / 否，
		// 并把 game_ended 置 yes（真正继续后又会清掉）。
		try { localStorage.setItem('game_ended', 'yes'); } catch (error) {}
		document.getElementById('a_propose_yes').style.display = 'none';
		document.getElementById('a_propose_no').style.display = 'none';
		document.getElementById('a_continue_yes').style.display = 'inline-block';
		document.getElementById('a_continue_no').style.display = 'inline-block';
		return;
	}
	mockExclude();
}
function mockChooseContinue(accept) {
	window.__pageClicks.push({ kind: accept ? 'continue_yes' : 'continue_no' });
	document.getElementById('a_continue_yes').style.display = 'none';
	document.getElementById('a_continue_no').style.display = 'none';
	document.getElementById('a_propose_yes').style.display = '';
	document.getElementById('a_propose_no').style.display = '';
	if (!accept) {
		mockButtons(false);
		mockSet('question-label', 'Akinator gave up');
		return;
	}
	mockExclude();
}
function mockExclude() {
	var step = mockStep;
	mockStep = mockStep + 1;
	mockPost('/exclude', {
		step: step,
		progression: 0,
		sid: document.getElementById('sid').value,
		cm: document.getElementById('cm').value,
		session: document.getElementById('session').value,
		signature: document.getElementById('signature').value,
		forward_answer: '1',
	}).then(mockRender);
}
`
}

/**
 * akinator 首页 / 主题选择页的最简结构：没有游戏区块，供「先跳游戏页」使用。
 * @returns {string} HTML
 */
function selectionPageHtml() {
	return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>mock akinator</title></head><body>
<div id="base-section">
	<div class="database-selection"><ul>
		<li class="li-game" onclick="chooseTheme('1')">Characters</li>
	</ul></div>
</div>
<form action="/game" method="post" id="formTheme"><input type="hidden" name="sid" id="sid"></form>
</body></html>`
}

/**
 * 订阅测试用的单角色数据库。
 * @returns {object} 数据库
 */
function remoteHeroDatabase() {
	return {
		version: 1,
		name: 'Remote Hero',
		characters: {
			'remote-hero': {
				id: 'remote-hero',
				name: 'Remote Hero',
				aliases: [],
				description: 'from remote character file',
				image: '',
				tags: [],
				region: 'en',
				sid: 1,
				mergedIds: [],
				createdAt: 0,
				updatedAt: 0,
				answers: {
					'is it a remote?': { answer: 0, question: 'Is it a remote?', weights: [3, 0, 0, 0, 0], count: 3, updatedAt: 0 },
				},
			},
		},
	}
}

/**
 * 把剧本项转换为接口响应。
 * @param {object} step 剧本项
 * @param {number} stepIndex 步数
 * @returns {object} 响应体
 */
function buildResponse(step, stepIndex) {
	if (step.kind === 'proposal')
		return {
			completion: 'OK',
			step: stepIndex,
			progression: 90,
			id_proposition: step.id,
			id_base_proposition: step.id,
			name_proposition: step.name,
			description_proposition: step.description ?? '',
			photo: step.photo ?? '',
			flag_photo: '',
			proba: 0.9,
			nb_elements: (step.candidates ?? []).length,
		}
	if (step.kind === 'defeat') return { completion: 'OK', step: stepIndex, progression: 100 }
	return {
		completion: 'OK',
		step: stepIndex,
		progression: Math.min(95, 10 + stepIndex * 10),
		question_id: step.questionId ?? `q${stepIndex}`,
		question: step.question,
		answers: ['Yes', 'No', 'Don\'t know', 'Probably', 'Probably not'],
	}
}

/**
 * 取当前会话的下一条剧本。
 * @param {string} sessionId 会话 id
 * @returns {object} 剧本项
 */
function nextStep(sessionId) {
	const session = sessions.get(sessionId) ?? { index: 0, step: 0, candidates: [] }
	sessions.set(sessionId, session)
	const step = scenario[Math.min(session.index, scenario.length - 1)] ?? { kind: 'defeat' }
	session.index++
	session.step++
	session.candidates = step.candidates ?? []
	return step
}

/**
 * 发送 JSON。
 * @param {import('node:http').ServerResponse} response 响应
 * @param {object} data 数据
 * @returns {void}
 */
function json(response, data) {
	response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
	response.end(JSON.stringify(data))
}

/**
 * 按剧本项回应一次 /answer 或 /exclude：`garbage` 返回非 JSON（模拟 Cloudflare 挑战页）。
 * @param {import('node:http').ServerResponse} response 响应
 * @param {object} step 剧本项
 * @param {number} stepIndex 步数
 * @returns {void}
 */
function sendStep(response, step, stepIndex) {
	if (step.kind === 'garbage') {
		response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
		response.end('<html><body>Just a moment…</body></html>')
		return
	}
	json(response, buildResponse(step, stepIndex))
}

/**
 * 请求分发。
 * @param {import('node:http').IncomingMessage} request 请求
 * @param {import('node:http').ServerResponse} response 响应
 * @returns {Promise<void>} 完成
 */
async function handler(request, response) {
	const url = new URL(request.url ?? '/', 'http://localhost')
	if (request.method === 'GET' && url.pathname === '/') {
		counter++
		const sessionId = `s${counter}`
		sessions.set(sessionId, { index: 0, step: 0, candidates: [] })
		response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
		response.end(gameHtml(sessionId, `sig${counter}`, `id${counter}`, 1, false))
		return
	}
	if (request.method === 'GET' && url.pathname === '/theme-selection') {
		response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
		response.end(selectionPageHtml())
		return
	}
	if (request.method === 'GET' && url.pathname === '/pack/index.json') {
		json(response, { version: 1, name: 'remote pack', characters: [{ name: 'Remote Hero', url: 'remote-hero.json', description: 'from remote list' }] })
		return
	}
	if (request.method === 'GET' && url.pathname === '/pack/remote-hero.json') {
		json(response, remoteHeroDatabase())
		return
	}
	if (request.method === 'POST' && url.pathname === '/game') {
		const postForm = await readForm(request)
		counter++
		gamePosts++
		timeline.push({ kind: 'game', at: Date.now() })
		const sessionId = `s${counter}`
		sessions.set(sessionId, { index: 0, step: 0, candidates: [] })
		response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
		response.end(gameHtml(sessionId, `sig${counter}`, `id${counter}`, Number(postForm.get('sid')) || 1, postForm.get('cm') === 'true'))
		return
	}
	const form = await readForm(request)
	if (request.method === 'POST' && url.pathname === '/answer') {
		const session = sessions.get(form.get('session') ?? '')
		const step = nextStep(form.get('session') ?? '')
		if (session) session.candidates = step.candidates ?? []
		sendStep(response, step, step.kind === 'defeat' ? 99 : session?.step ?? 1)
		return
	}
	if (request.method === 'POST' && url.pathname === '/exclude') {
		const session = sessions.get(form.get('session') ?? '')
		const step = nextStep(form.get('session') ?? '')
		if (session) session.candidates = step.candidates ?? []
		sendStep(response, step, session?.step ?? 1)
		return
	}
	if (request.method === 'POST' && url.pathname === '/cancel_answer') {
		json(response, buildResponse({ kind: 'question', question: 'A previous question?' }, 0))
		return
	}
	if (request.method === 'POST' && url.pathname === '/choice') {
		if (choiceDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, choiceDelayMs))
		timeline.push({ kind: 'choice', at: Date.now() })
		if (!response.destroyed) {
			response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
			response.end('<html><body><span class="win-sentence">Bravo!</span></body></html>')
		}
		return
	}
	if (url.pathname === '/ws/list.php') {
		const session = sessions.get(url.searchParams.get('session') ?? '')
		json(response, { elements: session?.candidates ?? [], nb_elements: session?.candidates?.length ?? 0 })
		return
	}
	response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
	response.end('not found')
}

/**
 * 启动模拟服务器。
 * @returns {Promise<{ origin: string; setScenario: (steps: object[]) => void; setChoiceDelay: (ms: number) => void; getGamePosts: () => number; getTimeline: () => { kind: 'choice' | 'game'; at: number }[]; close: () => Promise<void> }>} 服务器句柄
 */
export async function startMockServer() {
	const server = createServer((request, response) => {
		handler(request, response).catch((error) => {
			if (response.destroyed) return
			response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
			response.end(String(error))
		})
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	const address = server.address()
	const port = typeof address === 'object' && address ? address.port : 0
	return {
		origin: `http://127.0.0.1:${port}`,
		/**
		 * 设置下一次运行的剧本。
		 * @param {object[]} steps 剧本项
		 * @returns {void}
		 */
		setScenario(steps) {
			scenario = steps
			sessions.clear()
			gamePosts = 0
			choiceDelayMs = 0
			timeline.length = 0
		},
		/**
		 * 给 `/choice` 响应加延迟，模拟 akinator 的汇报请求尚未返回。
		 * @param {number} ms 毫秒
		 * @returns {void}
		 */
		setChoiceDelay(ms) {
			choiceDelayMs = Number(ms) || 0
		},
		/**
		 * 自上次设置剧本以来 `POST /game` 的次数（脚本自己开会话就会增加）。
		 * @returns {number} 次数
		 */
		getGamePosts() {
			return gamePosts
		},
		/**
		 * 关键请求的时间线（`/choice` 汇报与 `POST /game`），用于断言两者的先后。
		 * @returns {{ kind: 'choice' | 'game'; at: number }[]} 时间线副本
		 */
		getTimeline() {
			return timeline.map((entry) => ({ ...entry }))
		},
		/**
		 * 关闭服务器。
		 * @returns {Promise<void>} 完成
		 */
		close() {
			return new Promise((resolve) => server.close(() => resolve()))
		},
	}
}
