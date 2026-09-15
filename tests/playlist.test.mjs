import assert from 'node:assert/strict'
import { test } from 'node:test'

import { addToPlaylist, emptyPlaylist, ensurePlaylist, hasInPlaylist, nextTrackId, removeFromPlaylist, toggleInPlaylist } from '../src/shared/playlist.mjs'

/**
 * 造一个恒返回定值的随机数发生器，让随机播放的断言稳定。
 * @param {number} value 定值
 * @returns {() => number} 发生器
 */
function randomOf(value) {
	return () => value
}

test('歌单：归一化非法 / 陈旧数据', () => {
	assert.deepEqual(ensurePlaylist(undefined), { ids: [], mode: 'loop', active: false, currentId: '' })
	assert.deepEqual(ensurePlaylist({ ids: ['a', 'a', '', 'b'], mode: 'nope', active: true, currentId: 'zzz' }), { ids: ['a', 'b'], mode: 'loop', active: true, currentId: '' })
	assert.equal(ensurePlaylist({ ids: [], active: true }).active, false, '空歌单不应处于播放状态')
	assert.equal(ensurePlaylist({ ids: ['a'], currentId: 'a' }).currentId, 'a')
})

test('歌单：加入 / 移出 / 切换，并同步播放状态', () => {
	const playlist = emptyPlaylist()
	addToPlaylist(playlist, 'a')
	addToPlaylist(playlist, 'a')
	addToPlaylist(playlist, 'b')
	assert.deepEqual(playlist.ids, ['a', 'b'], '重复加入不应产生重复项')
	assert.ok(hasInPlaylist(playlist, 'a'))

	playlist.currentId = 'a'
	removeFromPlaylist(playlist, 'a')
	assert.deepEqual(playlist.ids, ['b'])
	assert.equal(playlist.currentId, '', '移出当前曲目后应清空当前曲目')

	toggleInPlaylist(playlist, 'b')
	assert.deepEqual(playlist.ids, [])
	assert.equal(playlist.active, false, '移空后应退出播放状态')
})

test('歌单：循环播放前后切歌并回绕', () => {
	const playlist = ensurePlaylist({ ids: ['a', 'b', 'c'], mode: 'loop', currentId: 'a' })
	assert.equal(nextTrackId(playlist, { direction: 1 }), 'b')
	assert.equal(nextTrackId(playlist, { direction: -1 }), 'c')
	assert.equal(nextTrackId({ ...playlist, currentId: 'c' }, { direction: 1 }), 'a', '末尾应回绕到开头')
	assert.equal(nextTrackId({ ...playlist, currentId: '' }, { direction: 1 }), 'a')
	assert.equal(nextTrackId({ ...playlist, currentId: '' }, { direction: -1 }), 'c')
	assert.equal(nextTrackId(emptyPlaylist()), '', '空歌单没有下一首')
})

test('歌单：单曲播放自动续播仍是同一首，手动切歌仍移动', () => {
	const playlist = ensurePlaylist({ ids: ['a', 'b'], mode: 'single', currentId: 'a' })
	assert.equal(nextTrackId(playlist, { auto: true }), 'a', '单曲播放应循环当前曲目')
	assert.equal(nextTrackId(playlist, { direction: 1 }), 'b', '手动切歌仍应换角色')
})

test('歌单：随机播放尽量避开当前曲目', () => {
	const playlist = ensurePlaylist({ ids: ['a', 'b', 'c'], mode: 'shuffle', currentId: 'a' })
	assert.equal(nextTrackId(playlist, { random: randomOf(0) }), 'b')
	assert.equal(nextTrackId(playlist, { random: randomOf(0.999) }), 'c')
	assert.equal(nextTrackId({ ...playlist, ids: ['a'] }, { random: randomOf(0.5) }), 'a', '只有一首时随机仍是它')
})
