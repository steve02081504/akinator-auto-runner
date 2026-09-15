/**
 * 在元素从 DOM 移除时调用回调（与 fount 同实现）。
 * @param {HTMLElement} element 要观察的元素
 * @param {Function} callback 元素被移除时调用的回调
 * @returns {Function} 取消监听并自动调用回调的函数
 */
export function onElementRemoved(element, callback) {
	const observer = new MutationObserver(function (mutations) {
		if (!document.body.contains(element)) {
			callback()
			this.disconnect()
		}
	})
	const interval = setInterval(() => {
		if (document.body.contains(element)) {
			observer.observe(element.parentElement, { childList: true })
			clearInterval(interval)
		}
	}, 100)
	return () => {
		observer.disconnect()
		clearInterval(interval)
		callback()
	}
}
