/**
 * 数据标签页的模板数据。
 * @module userscript/ui/data_view
 */

import { PAGES_URL, REPO_URL, USERSCRIPT_URL } from '../../shared/constants.mjs'
import { icon } from '../../shared/icons.mjs'
import { geti18n } from '../i18n.mjs'

import { templates } from './templates.mjs'

/**
 * 数据标签数据。
 * @param {import('./index.mjs').PanelUI} ui 面板
 * @returns {Promise<object>} 数据
 */
export async function dataData(ui) {
	const subscriptions = await Promise.all(ui.app.subscriptions.map(async (subscription) => ({
		id: subscription.id,
		name: subscription.name,
		url: subscription.url,
		enabled: subscription.enabled,
		autoUpdate: subscription.autoUpdate,
		kindLabel: geti18n(subscription.kind === 'character' ? 'data.subscribeCharacter' : 'data.subscribeList'),
		deleteIcon: icon('trash', { size: 13 }),
		refreshIcon: icon('refresh', { size: 13 }),
		lastError: subscription.lastError ? `<div class="aar-warn">${subscription.lastError}</div>` : '',
	})))
	return {
		folderNote: ui.app.localDb.handle ? geti18n('data.connectedFolder', { name: ui.app.sourceName }) : geti18n('data.noFolder'),
		subscriptions: await templates.renderListAsHtmlString('subscription', subscriptions),
		localIcon: icon('database', { size: 14 }),
		folderIcon: icon('folder-open', { size: 13 }),
		saveIcon: icon('save', { size: 13 }),
		downloadIcon: icon('download', { size: 13 }),
		importIcon: icon('link', { size: 14 }),
		addIcon: icon('plus', { size: 13 }),
		refreshIcon: icon('refresh', { size: 13 }),
		REPO_URL,
		PAGES_URL,
		USERSCRIPT_URL,
	}
}
