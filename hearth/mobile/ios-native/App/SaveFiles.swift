import UIKit

/// Saving files the page offers (<a download>): web views ignore those, so ios.js hands the bytes over in base64
/// chunks of 384 KB (saveStart, saveChunk..., saveEnd), the same as the Android app. The file is written to the app's
/// temporary folder, then the share sheet offers it (Save to Files, Photos, AirDrop, another app); the copy here is
/// removed once the sheet closes. A file is at most 2 GB.
@MainActor
final class SaveFiles: NSObject {
    static let shared = SaveFiles()

    private static let maxBytes: Int64 = 2 * 1024 * 1024 * 1024
    private static let maxChunk = 768 * 1024 // base64 of a 384 KB chunk is 512 KB

    private struct Saving { let dir: URL; let file: URL; let handle: FileHandle; var size: Int64 }
    private var saving: [String: Saving] = [:]
    private var waiting: [URL] = [] // finished files whose sheet waits for the one showing

    private var root: URL { FileManager.default.temporaryDirectory.appendingPathComponent("hearth-save", isDirectory: true) }

    /// Files left behind when the app was closed mid-save or with a sheet open.
    func cleanLeftovers() {
        guard saving.isEmpty, waiting.isEmpty else { return }
        try? FileManager.default.removeItem(at: root)
    }

    // A name for the file as it will show in Files: no folders, no characters Files won't take, never hidden.
    static func safeName(_ name: String) -> String {
        let bad = CharacterSet(charactersIn: "\\/:*?\"<>|").union(.controlCharacters)
        var scalars = String.UnicodeScalarView()
        for u in name.unicodeScalars { scalars.append(bad.contains(u) ? "_" : u) }
        var s = String(scalars)
        s = s.trimmingCharacters(in: .whitespacesAndNewlines)
        while s.hasPrefix(".") { s.removeFirst() }
        if s.count > 200 { s = String(s.prefix(200)) }
        return s.isEmpty ? "file" : s
    }

    private static func validId(_ id: String) -> Bool {
        !id.isEmpty && id.count <= 64 && id.unicodeScalars.allSatisfy { CharacterSet.alphanumerics.contains($0) && $0.isASCII }
    }

    func start(id: String, name: String, mime: String) {
        guard SaveFiles.validId(id), saving[id] == nil else { return }
        let fm = FileManager.default
        // Each file gets a folder of its own, so two saves of the same name don't meet.
        let dir = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let file = dir.appendingPathComponent(SaveFiles.safeName(name), isDirectory: false)
        guard file.deletingLastPathComponent().standardizedFileURL == dir.standardizedFileURL else { return }
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            guard fm.createFile(atPath: file.path, contents: nil) else { throw CocoaError(.fileWriteUnknown) }
            let handle = try FileHandle(forWritingTo: file)
            saving[id] = Saving(dir: dir, file: file, handle: handle, size: 0)
        } catch {
            try? fm.removeItem(at: dir)
            failed()
        }
    }

    func chunk(id: String, data: String) {
        guard var s = saving[id] else { return }
        guard data.utf8.count <= SaveFiles.maxChunk, let bytes = Data(base64Encoded: data) else { discard(id); failed(); return }
        s.size += Int64(bytes.count)
        if s.size > SaveFiles.maxBytes { discard(id); failed(); return }
        do {
            try s.handle.write(contentsOf: bytes)
            saving[id] = s
        } catch {
            discard(id)
            failed()
        }
    }

    func end(id: String) {
        guard let s = saving.removeValue(forKey: id) else { return }
        do {
            try s.handle.close()
        } catch {
            try? FileManager.default.removeItem(at: s.dir)
            failed()
            return
        }
        waiting.append(s.file)
        showNext()
    }

    private func discard(_ id: String) {
        guard let s = saving.removeValue(forKey: id) else { return }
        try? s.handle.close()
        try? FileManager.default.removeItem(at: s.dir)
    }

    private func failed() {
        HearthViewController.current?.notice("Couldn\u{2019}t save the file.")
    }

    // One share sheet at a time; the next file's comes up when it closes.
    private var showing = false

    private func showNext() {
        guard !showing, !waiting.isEmpty, let vc = HearthViewController.current, let top = vc.topController() else { return }
        let file = waiting.removeFirst()
        showing = true
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        sheet.completionWithItemsHandler = { [weak self] _, _, _, _ in
            try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
            self?.showing = false
            self?.showNext()
        }
        // iPad: the sheet is a popover, pointing at the middle of the screen.
        if let pop = sheet.popoverPresentationController {
            pop.sourceView = vc.view
            pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 0, height: 0)
            pop.permittedArrowDirections = []
        }
        top.present(sheet, animated: true)
    }
}
