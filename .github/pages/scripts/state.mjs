/**
 * 站点共享状态与数据结构。
 * @module site/scripts/state
 */

import { emptyDevotion } from '../shared/devotion.mjs'
import { emptyDatabase } from '../shared/schema.mjs'
import { Store } from '../shared/store.mjs'

/**
 * 站点状态。所有渲染函数与事件处理器读写同一个对象。
 * @type {{
 *   pageStore: Store,
 *   remoteStore: Store,
 *   remoteDevotion: Aki.Devotion,
 *   packs: { name: string; url: string; description?: string }[],
 *   subscriptions: Aki.Subscription[],
 *   connected: boolean,
 *   popup: Window | undefined,
 *   popupRegion: string,
 *   region: string,
 *   runState: Aki.RunState | undefined,
 *   runMode: Aki.RunMode,
 *   runCharacterPicked: boolean,
 *   askQuestion: Aki.Question | undefined,
 *   proposal: Aki.Proposal | undefined,
 *   suggested: Aki.Guess | undefined,
 *   created: Aki.CreatedCharacter | undefined,
 *   delay: Aki.DelayState | undefined,
 *   intervention: Aki.InterventionState | undefined,
 *   logs: Aki.LogEntry[],
 *   hello: Aki.HelloInfo | undefined,
 *   settings: Partial<Aki.Settings> | undefined,
 *   sourceFilter: string,
 *   pingTimer: ReturnType<typeof setInterval> | undefined,
 *   popupWatchTimer: ReturnType<typeof setInterval> | undefined,
 * }}
 */
export const state = {
	pageStore: new Store(emptyDatabase('packs')),
	remoteStore: new Store(emptyDatabase('script')),
	remoteDevotion: emptyDevotion(),
	packs: [],
	subscriptions: [],
	connected: false,
	popup: undefined,
	popupRegion: '',
	region: 'en',
	runState: undefined,
	runMode: 'replay',
	runCharacterPicked: false,
	askQuestion: undefined,
	proposal: undefined,
	suggested: undefined,
	created: undefined,
	delay: undefined,
	intervention: undefined,
	logs: [],
	hello: undefined,
	settings: undefined,
	sourceFilter: 'all',
	pingTimer: undefined,
	popupWatchTimer: undefined,
}
