// ===== 本项目不启用二级锁（防未成年人）=====
// 始终视为已解锁，让 default-cards.js / chat.js 的系统预设字卡正常参与
window.cardLockOpen = function () { return true; };