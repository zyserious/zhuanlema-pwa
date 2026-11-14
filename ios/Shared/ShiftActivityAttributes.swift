import Foundation
import ActivityKit

/// 主 App 与 Widget Extension 共用的数据契约。
/// 改了这里的字段，两边要一起重新编译，否则反序列化会失败。
struct ShiftActivityAttributes: ActivityAttributes {

    struct ContentState: Codable, Hashable {
        /// 已赚金额（上次刷新时的快照；之后由系统的倒计时/进度条自己走）
        var earned: Double
        /// 本班次开始时刻
        var startDate: Date
        /// 本班次结束时刻
        var endDate: Date
        /// 最后一次同步时刻，用于在界面上标注新鲜度
        var updatedAt: Date
    }

    /// 班次名，如「夜班」
    var shiftName: String
    /// 班次图标，emoji
    var emoji: String
    /// 今日应得（满勤）
    var dayTotal: Double
    /// 班次时间段文案，如「16:00 – 24:00」
    var windowText: String
}

extension ShiftActivityAttributes {
    static let preview = ShiftActivityAttributes(
        shiftName: "夜班", emoji: "🌙", dayTotal: 192.31, windowText: "16:00 – 24:00"
    )
}

extension ShiftActivityAttributes.ContentState {
    static let preview = ShiftActivityAttributes.ContentState(
        earned: 154.03,
        startDate: Date().addingTimeInterval(-4 * 3600),
        endDate: Date().addingTimeInterval(2 * 3600),
        updatedAt: Date()
    )
}
