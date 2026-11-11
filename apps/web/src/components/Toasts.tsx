import { ToastContainer } from "react-toastify";

/** App-wide notifications (loaded lazily so the start page stays small). */
export default function Toasts() {
    return (
        <ToastContainer
            position="top-center"
            theme="dark"
            autoClose={3000}
            newestOnTop
            closeButton={false}
            toastClassName="!rounded-2xl !bg-slate-900 !border !border-white/10 !text-sm"
            style={{ top: "calc(env(safe-area-inset-top) + 64px)" }}
        />
    );
}
