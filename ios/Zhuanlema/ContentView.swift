import SwiftUI

struct ContentView: View {
    private let bg = Color(red: 0.08, green: 0.07, blue: 0.05)
    private let card = Color(red: 0.12, green: 0.10, blue: 0.08)
    private let ink = Color(red: 0.96, green: 0.94, blue: 0.88)
    private let dim = Color(red: 0.56, green: 0.53, blue: 0.48)
    private let accent = Color(red: 0.94, green: 0.60, blue: 0.48)

    @State private var token: String? = Keychain.read("token")
    @State private var user: String = UserDefaults.standard.string(forKey: "lastUser") ?? ""
    @State private var pass: String = ""
    @State private var payload: TodayPayload?
    @State private var fetchedAt: Date = Date()
    @State private var note: String = ""
    @State private var busy: Bool = false
    @State private var liveOn: Bool = LiveActivityManager.running

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if token == nil {
                        loginCard
                    } else {
                        mainCard
                        actionButtons
                    }
                    if !note.isEmpty {
                        Text(note)
                            .font(.footnote)
                            .foregroundStyle(dim)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 8)
                    }
                }
                .padding(20)
            }
            .background(bg.ignoresSafeArea())
            .navigationTitle("今天赚了吗")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
        .preferredColorScheme(.dark)
        .task {
            if token != nil { await refresh() }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
            guard token != nil else { return }
            Task { await refresh() }
        }
    }

    private var loginCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("登录一次，之后就一直记得")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(ink)
            TextField("账号", text: $user)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(12)
                .background(card)
                .cornerRadius(10)
                .foregroundStyle(ink)
            SecureField("密码", text: $pass)
                .padding(12)
                .background(card)
                .cornerRadius(10)
                .foregroundStyle(ink)
            Button {
                Task { await doLogin() }
            } label: {
                HStack {
                    if busy { ProgressView().tint(bg) }
                    Text(busy ? "登录中" : "登录")
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
            }
            .buttonStyle(.borderedProminent)
            .tint(accent)
            .foregroundStyle(Color(red: 0.10, green: 0.07, blue: 0.05))
            .disabled(busy)
        }
        .padding(18)
        .background(card.opacity(0.55))
        .cornerRadius(16)
    }

    @ViewBuilder
    private var mainCard: some View {
        if let p = payload {
            VStack(spacing: 14) {
                HStack(spacing: 6) {
                    Text(p.shiftEmoji)
                    Text(p.shiftName).font(.footnote.weight(.semibold))
                    Text(p.windowText).font(.caption).foregroundStyle(dim)
                    Spacer()
                    Circle()
                        .fill(p.status == "working" ? Color.green : dim.opacity(0.5))
                        .frame(width: 7, height: 7)
                }
                .foregroundStyle(ink)

                TimelineView(.periodic(from: .now, by: 1)) { _ in
                    Text(yuan(projected(p)))
                        .font(.system(size: 52, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(accent)
                        .frame(maxWidth: .infinity, alignment: .center)
                }

                Text(headline(p))
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(ink)

                ProgressView(value: min(1, max(0, p.progress)))
                    .tint(accent)

                HStack {
                    Text("今天目标 ¥\(plain(p.dayTotal))")
                    Spacer()
                    Text("进度 \(Int((p.progress * 100).rounded()))%")
                }
                .font(.caption)
                .foregroundStyle(dim)
            }
            .padding(18)
            .background(card)
            .cornerRadius(16)
        } else {
            VStack(spacing: 10) {
                ProgressView().tint(accent)
                Text("读取中…").font(.footnote).foregroundStyle(dim)
            }
            .frame(maxWidth: .infinity)
            .padding(30)
            .background(card)
            .cornerRadius(16)
        }
    }

    private var actionButtons: some View {
        VStack(spacing: 10) {
            Button {
                Task { await toggleLive() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: liveOn ? "checkmark.circle.fill" : "bolt.horizontal.circle.fill")
                    Text(liveOn ? "灵动岛正在显示" : "在灵动岛 / 锁屏上显示")
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
            }
            .buttonStyle(.borderedProminent)
            .tint(accent)
            .foregroundStyle(Color(red: 0.10, green: 0.07, blue: 0.05))
            .disabled(busy || payload == nil)

            HStack(spacing: 10) {
                Button {
                    Task { await refresh() }
                } label: {
                    Text("刷新一下").frame(maxWidth: .infinity).padding(.vertical, 12)
                }
                .buttonStyle(.bordered)
                .tint(dim)

                Button {
                    Task { await stopLive() }
                } label: {
                    Text("结束显示").frame(maxWidth: .infinity).padding(.vertical, 12)
                }
                .buttonStyle(.bordered)
                .tint(dim)
                .disabled(!liveOn)
            }

            HStack(spacing: 14) {
                if let t = token {
                    Text("账号 \(user.isEmpty ? "—" : user) · \(t.prefix(6))…")
                        .font(.caption2)
                        .foregroundStyle(dim)
                }
                Spacer()
                Button("退出登录") { logout() }
                    .font(.caption2)
                    .foregroundStyle(dim)
            }
            .padding(.top, 2)
        }
    }

    // MARK: - 行为

    private func doLogin() async {
        let u = user.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !u.isEmpty, !pass.isEmpty else { note = "账号和密码都要填"; return }
        busy = true
        note = ""
        do {
            let t = try await API.login(u, pass)
            Keychain.save(t, for: "token")
            UserDefaults.standard.set(u, forKey: "lastUser")
            token = t
            user = u
            pass = ""
            await refresh()
        } catch {
            note = "登录失败：\(error.localizedDescription)"
        }
        busy = false
    }

    private func refresh() async {
        guard let t = token else { return }
        do {
            let p = try await API.today(t)
            payload = p
            fetchedAt = Date()
            liveOn = LiveActivityManager.running
            if liveOn { await LiveActivityManager.update(p) }
        } catch {
            note = error.localizedDescription
            if error.localizedDescription.contains("登录过期") { logout() }
        }
    }

    private func toggleLive() async {
        guard let p = payload else { return }
        if liveOn {
            await stopLive()
            return
        }
        do {
            try LiveActivityManager.start(p)
            try? await Task.sleep(nanoseconds: 300_000_000)
            liveOn = LiveActivityManager.running
            note = liveOn ? "已经放到灵动岛和锁屏上了" : "没起来，检查 设置 → 今天赚了吗 → 实时活动"
        } catch {
            note = error.localizedDescription
        }
    }

    private func stopLive() async {
        await LiveActivityManager.stopAll()
        liveOn = false
        note = "已从灵动岛移除"
    }

    private func logout() {
        Keychain.delete("token")
        token = nil
        payload = nil
        note = ""
        Task { await LiveActivityManager.stopAll() }
        liveOn = false
    }

    // MARK: - 展示

    private func projected(_ p: TodayPayload) -> Double {
        guard p.status == "working" else { return p.earned }
        let elapsed = Date().timeIntervalSince(fetchedAt)
        return min(p.dayTotal, p.earned + p.perSec * elapsed)
    }

    private func headline(_ p: TodayPayload) -> String {
        switch p.status {
        case "working":
            let sec = max(0, p.remainSec - Int(Date().timeIntervalSince(fetchedAt)))
            return "还剩 " + hms(sec)
        case "before":
            return "距开工 " + hms(p.untilStartSec)
        case "done":
            return "收工，今天赚完了"
        default:
            return "今天不用上班"
        }
    }

    private func hms(_ sec: Int) -> String {
        let s = max(0, sec)
        let h = s / 3600, m = (s % 3600) / 60, ss = s % 60
        return h > 0
            ? String(format: "%d:%02d:%02d", h, m, ss)
            : String(format: "%d:%02d", m, ss)
    }

    private func yuan(_ v: Double) -> String {
        String(format: "¥%.2f", max(0, v))
    }

    private func plain(_ v: Double) -> String {
        String(format: "%.2f", max(0, v))
    }
}

#Preview {
    ContentView()
}
