import React from 'react';
interface MenuItemProps {
  icon?: string;
  label: string;
  action: () => void;
  active?: boolean;
}

export const MenuItem: React.FC<MenuItemProps> = ({ icon, label, action, active }) => {
  return (
    <div
      className="opacity-80 hover:opacity-100 blue-bg-hover flex fex-col items-center justify-center cursor-pointer px-1 py-1 rounded"
      onClick={action}
    >
      <span className="text-xl flex dark-text font-semibold">
        {icon && <img src={icon} alt="" className="h-5 m-1" />}
        {label
          .split(' ')
          .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ')}
      </span>
      {active}
    </div>
  );
};
