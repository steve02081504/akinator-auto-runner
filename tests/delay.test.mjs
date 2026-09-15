import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DELAY_JITTER, DELAY_READING_MS_PER_CHAR, humanDelayMs, timeOfDayFactor } from '../src/shared/delay.mjs'

/** 一个「不抖动、非高峰时段」的稳定基准时刻。 */
const CALM = new Date('2026-01-01T08:00:00')

/**
 * 恒返回 0.5 的随机源（对应「无抖动」）。
 * @returns {number} 0.5
 */
function midpoint() {
	return 0.5
}

/**
 * 恒返回 0 的随机源（对应抖动下界）。
 * @returns {number} 0
 */
function lowest() {
	return 0
}

/**
 * 恒返回 1 的随机源（对应抖动上界）。
 * @returns {number} 1
 */
function highest() {
	return 1
}

test('类人延时：基数为 0 / 非法值时不延时', () => {
	assert.equal(humanDelayMs(0), 0)
	assert.equal(humanDelayMs(-100), 0)
	assert.equal(humanDelayMs(Number.NaN), 0)
})

test('类人延时：随机扰动落在平均值 ±30% 内', () => {
	assert.equal(humanDelayMs(5000, { random: midpoint, date: CALM }), 5000)
	assert.equal(humanDelayMs(5000, { random: lowest, date: CALM }), Math.round(5000 * (1 - DELAY_JITTER)))
	assert.equal(humanDelayMs(5000, { random: highest, date: CALM }), Math.round(5000 * (1 + DELAY_JITTER)))
})

test('类人延时：题目越长读题越久', () => {
	const short = humanDelayMs(1000, { random: midpoint, date: CALM, textLength: 0 })
	const long = humanDelayMs(1000, { random: midpoint, date: CALM, textLength: 50 })
	assert.equal(long - short, 50 * DELAY_READING_MS_PER_CHAR)
})

test('类人延时：半夜与中午反应更慢', () => {
	assert.equal(timeOfDayFactor(CALM), 1)
	assert.ok(timeOfDayFactor(new Date('2026-01-01T03:00:00')) > 1.2, '凌晨应更慢')
	assert.ok(timeOfDayFactor(new Date('2026-01-01T12:30:00')) > 1.2, '午后应更慢')
})
