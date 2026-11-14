import Foundation
import ActivityKit

/// 灵动岛的开关。全部在本地发起，不依赖 APNs 推送，
/// 所以免费开发者账号（没有 Push 权限）也能用。
enum LiveActivityManager {

    static var systemAllowed: Bool {
        ActivityAuthorizationInfo().areActivitiesEnabled
    }

    static var running: Bool {
        !Activity<ShiftActivityAttributes>.activities.isEmpty
    }

    /// 班次窗口 → 今天的具体时刻（服务端给的是「当天第几秒」）
    static func windowDates(_ p: TodayPayload) -> (start: Date, end: Date)? {
        guard let w = p.window, w.count == 2, w[1] > w[0] else { return nil }
        if p.status == "off" { return nil }
        let dayStart = Calendar.current.startOfDay(for: Date())
        let start = dayStart.addingTimeInterval(TimeInterval(w[0]))
        let end = dayStart.addingTimeInterval(TimeInterval(w[1]))
        return (start, end)
    }

    static func start(_ p: TodayPayload) throws {
        guard let w = windowDates(p) else {
            throw APIError.message("现在没有进行中的班次（休息或未排班）")
        }
        guard systemAllowed else {
            throw APIError.message("系统关掉了实时活动：设置 → 今天赚了吗 → 实时活动")
        }
        // 已经有就更新，避免叠出两条
        if running {
            Task { await update(p) }
            return
        }

        let attrs = ShiftActivityAttributes(
            shiftName: p.shiftName,
            emoji: p.shiftEmoji,
            dayTotal: p.dayTotal,
            windowText: p.windowText
        )
        let state = ShiftActivityAttributes.ContentState(
            earned: p.earned,
            startDate: w.start,
            endDate: w.end,
            updatedAt: Date()
        )
        let content = ActivityContent(state: state, staleDate: w.end.addingTimeInterval(1800))
        _ = try Activity.request(attributes: attrs, content: content, pushType: nil)
    }

    static func update(_ p: TodayPayload) async {
        guard let w = windowDates(p) else { return }
        let state = ShiftActivityAttributes.ContentState(
            earned: p.earned,
            startDate: w.start,
            endDate: w.end,
            updatedAt: Date()
        )
        let content = ActivityContent(state: state, staleDate: w.end.addingTimeInterval(1800))
        for activity in Activity<ShiftActivityAttributes>.activities {
            await activity.update(content)
        }
    }

    static func stopAll() async {
        for activity in Activity<ShiftActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}
