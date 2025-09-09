import { NavLink } from "react-router";
import { colorClasses } from "./colors";

export function Sidebar() {
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `hover:scale-105 block rounded-xl mx-2 my-8 px-3 py-2 ${isActive ? colorClasses.slate.bg : colorClasses.white.text}`;
  return (
    <nav className="w-48 flex-shrink-0 py-4 px-2 text-center text-lg">
      <NavLink to="" end className={linkCls}>
        Dashboard
      </NavLink>
      <NavLink to="manage" className={linkCls}>
        Manage
      </NavLink>
      <NavLink to="fund" className={linkCls}>
        Fund
      </NavLink>
      <NavLink to="send" className={linkCls}>
        Send
      </NavLink>
      <NavLink to="receive" className={linkCls}>
        Receive
      </NavLink>
      <NavLink to="extract" className={linkCls}>
        Extract
      </NavLink>
      <NavLink to="history" className={linkCls}>
        History
      </NavLink>
    </nav>
  );
}
