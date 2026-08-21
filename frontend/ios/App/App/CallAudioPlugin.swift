import AVFAudio
import Capacitor
import UIKit

final class AppBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginType(CallAudioPlugin.self)
    }
}

@objc(CallAudioPlugin)
public class CallAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CallAudioPlugin"
    public let jsName = "CallAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "activate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVideo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setProximity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deactivate", returnType: CAPPluginReturnPromise)
    ]

    private let session = AVAudioSession.sharedInstance()
    private var active = false
    private var video = false
    private var proximityRequested = false
    private var routeObserver: NSObjectProtocol?

    @objc override public func load() {
        routeObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: session,
            queue: .main
        ) { [weak self] _ in
            guard let self, self.active else { return }
            self.syncProximity()
            self.notifyListeners("routeChanged", data: self.routeState())
        }
    }

    deinit {
        if let routeObserver {
            NotificationCenter.default.removeObserver(routeObserver)
        }
        DispatchQueue.main.async { [session] in
            UIDevice.current.isProximityMonitoringEnabled = false
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    @objc func activate(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.video = call.getBool("video", false)
            do {
                try self.configureSession()
                self.active = true
                call.resolve(self.routeState())
            } catch {
                call.reject("native call audio activation failed", nil, error)
            }
        }
    }

    @objc func setVideo(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.video = call.getBool("video", false)
            do {
                if self.active { try self.configureSession() }
                self.syncProximity()
                call.resolve(self.routeState())
            } catch {
                call.reject("native call audio mode failed", nil, error)
            }
        }
    }

    @objc func setRoute(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.active else {
                call.reject("call audio is inactive")
                return
            }
            do {
                switch call.getString("route", "system") {
                case "speaker":
                    try self.session.setPreferredInput(nil)
                    try self.session.overrideOutputAudioPort(.speaker)
                case "earpiece":
                    guard UIDevice.current.userInterfaceIdiom == .phone else {
                        call.reject("earpiece is unavailable")
                        return
                    }
                    let builtInMic = self.session.availableInputs?.first {
                        $0.portType == .builtInMic
                    }
                    try self.session.setPreferredInput(builtInMic)
                    try self.session.overrideOutputAudioPort(.none)
                case "system":
                    try self.session.setPreferredInput(nil)
                    try self.session.overrideOutputAudioPort(.none)
                default:
                    call.reject("unknown call audio route")
                    return
                }
                self.syncProximity()
                let state = self.routeState()
                self.notifyListeners("routeChanged", data: state)
                call.resolve(state)
            } catch {
                call.reject("native call audio route failed", nil, error)
            }
        }
    }

    @objc func setProximity(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.proximityRequested = call.getBool("enabled", false)
            self.syncProximity()
            call.resolve()
        }
    }

    @objc func deactivate(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.deactivateSession()
            call.resolve()
        }
    }

    private func configureSession() throws {
        let mode: AVAudioSession.Mode = video ? .videoChat : .voiceChat
        try session.setCategory(
            .playAndRecord,
            mode: mode,
            options: [.allowBluetooth, .allowBluetoothA2DP]
        )
        try session.setActive(true)
    }

    private func routeState() -> JSObject {
        let output = session.currentRoute.outputs.first?.portType
        let selectedRoute: String
        if output == .builtInSpeaker {
            selectedRoute = "speaker"
        } else if output == .builtInReceiver {
            selectedRoute = "earpiece"
        } else {
            selectedRoute = "system"
        }
        return [
            "selectedRoute": selectedRoute,
            "earpieceAvailable": UIDevice.current.userInterfaceIdiom == .phone
        ]
    }

    private func syncProximity() {
        let usingReceiver = session.currentRoute.outputs.first?.portType == .builtInReceiver
        UIDevice.current.isProximityMonitoringEnabled = active
            && proximityRequested
            && !video
            && usingReceiver
    }

    private func deactivateSession() {
        proximityRequested = false
        UIDevice.current.isProximityMonitoringEnabled = false
        guard active else { return }
        active = false
        try? session.setPreferredInput(nil)
        try? session.overrideOutputAudioPort(.none)
        try? session.setActive(false, options: .notifyOthersOnDeactivation)
    }
}
