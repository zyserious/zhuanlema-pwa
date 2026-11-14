import Foundation
import SwiftUI
import WidgetKit
import ActivityKit

@main
struct ZhuanlemaWidgetBundle: WidgetBundle {
    var body: some Widget {
        ShiftLiveActivity()
    }
}

struct ShiftLiveActivity: Widget {
    private let ink = Color(red: 0.96, green: 0.94, blue: 0.88)
    private let dim = Color(red: 0.63, green: 0.60, blue: 0.54)
    private let accent = Color(red: 0.94, green: 0.60, blue: 0.48)

    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ShiftActivityAttributes.self) { context in
            lockScreen(context)
                .activityBackgroundTint(Color(red: 0.08, green: 0.07, blue: 0.05))
                .activitySystemActionForegroundColor(ink)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 5) {
                        Text(context.attributes.emoji)
                        Text(context.attributes.shiftName)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(ink)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(yuan(context.state.earned))
                        .font(.system(size: 19, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(accent)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 7) {
                        ProgressView(timerInterval: context.state.startDate...context.state.endDate,
                                     countsDown: false)
                            .tint(accent)
                        HStack(spacing: 4) {
                            Text("还剩")
                                .foregroundStyle(dim)
                            Text(timerInterval: Date()...context.state.endDate, countsDown: true)
                                .monospacedDigit()
                                .foregroundStyle(ink)
                            Spacer(minLength: 8)
                            Text("目标 ¥\(plain(context.attributes.dayTotal))")
                                .foregroundStyle(dim)
                        }
                        .font(.caption2)
                    }
                }
            } compactLeading: {
                Text(context.attributes.emoji)
                    .font(.system(size: 13))
            } compactTrailing: {
                Text(timerInterval: Date()...context.state.endDate, countsDown: true)
                    .monospacedDigit()
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(accent)
                    .frame(width: 52, alignment: .trailing)
            } minimal: {
                Text(context.attributes.emoji)
                    .font(.system(size: 13))
            }
            .keylineTint(accent)
        }
    }

    @ViewBuilder
    private func lockScreen(_ context: ActivityViewContext<ShiftActivityAttributes>) -> some View {
        VStack(spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 5) {
                        Text(context.attributes.emoji)
                        Text(context.attributes.shiftName)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(ink)
                    }
                    Text(context.attributes.windowText)
                        .font(.caption2)
                        .foregroundStyle(dim)
                }
                Spacer(minLength: 12)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(yuan(context.state.earned))
                        .font(.system(size: 26, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(accent)
                    Text("目标 ¥\(plain(context.attributes.dayTotal))")
                        .font(.caption2)
                        .foregroundStyle(dim)
                }
            }
            ProgressView(timerInterval: context.state.startDate...context.state.endDate,
                         countsDown: false)
                .tint(accent)
            HStack {
                Text("还剩")
                    .font(.caption)
                    .foregroundStyle(dim)
                Text(timerInterval: Date()...context.state.endDate, countsDown: true)
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(ink)
                Spacer()
                Text("更新于 \(hm(context.state.updatedAt))")
                    .font(.caption2)
                    .foregroundStyle(dim)
            }
        }
        .padding(16)
    }

    private func yuan(_ v: Double) -> String {
        let n = max(0, v)
        return String(format: "¥%.2f", n)
    }

    private func plain(_ v: Double) -> String {
        String(format: "%.2f", max(0, v))
    }

    private func hm(_ d: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: d)
    }
}
