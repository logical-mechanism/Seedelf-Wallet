import { NavLink } from "react-router";

export function Sidebar() {
    const linkCls = ({ isActive }: { isActive: boolean }) =>
        `block rounded px-3 py-2 ${isActive ? "bg-gray-700 text-white" : "text-gray-300 hover:bg-gray-800"}`;
    return (
        <nav className="w-48 flex-shrink-0 py-4 px-2">
            <NavLink to="" end className={linkCls}>Dashboard</NavLink>
            <NavLink to="manage" className={linkCls}>Manage</NavLink>
            <NavLink to="fund" className={linkCls}>Fund</NavLink>
            <NavLink to="send" className={linkCls}>Send</NavLink>
            <NavLink to="receive" className={linkCls}>Receive</NavLink>
            <NavLink to="history" className={linkCls}>History</NavLink>
        </nav>
    );
}
