/**
 * 油猴面板模板（构建期由 esbuild text loader 内联为字符串）。
 *
 * 脚本运行在 akinator 页面，无法 fetch 我们的模板文件，所以模板必须内联进单文件脚本。
 * @module userscript/views
 */

import answerButton from './answer-button.html'
import ask from './ask.html'
import avatar from './avatar.html'
import candidate from './candidate.html'
import characterCard from './character-card.html'
import characters from './characters.html'
import created from './created.html'
import data from './data.html'
import delay from './delay.html'
import distributionBar from './distribution-bar.html'
import editor from './editor.html'
import guess from './guess.html'
import intervention from './intervention.html'
import log from './log.html'
import message from './message.html'
import option from './option.html'
import panel from './panel.html'
import player from './player.html'
import playlistTrack from './playlist-track.html'
import proposal from './proposal.html'
import questionWeights from './question-weights.html'
import runParts from './run-parts.html'
import runStatus from './run-status.html'
import run from './run.html'
import session from './session.html'
import sponsor from './sponsor.html'
import subscription from './subscription.html'
import tab from './tab.html'
import tag from './tag.html'
import weightRow from './weight-row.html'

/** 模板名 → 模板文本。 */
export default {
	'answer-button': answerButton,
	ask,
	avatar,
	candidate,
	'character-card': characterCard,
	characters,
	created,
	data,
	delay,
	'distribution-bar': distributionBar,
	editor,
	guess,
	intervention,
	log,
	message,
	option,
	panel,
	player,
	'playlist-track': playlistTrack,
	proposal,
	'question-weights': questionWeights,
	run,
	'run-parts': runParts,
	'run-status': runStatus,
	session,
	sponsor,
	subscription,
	tab,
	tag,
	'weight-row': weightRow,
}
