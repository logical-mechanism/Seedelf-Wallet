import Link from 'next/link';
import { useState, useCallback, useEffect } from 'react';
import { CardanoWallet } from '../components/CardanoWallet';
import { BrowserWallet, UTxO } from '@meshsdk/core';

interface NavBarProps {}

const networkFlag: number = parseInt(process.env.NEXT_PUBLIC_NETWORK_FLAG || '-1')

const NavBar: React.FC<NavBarProps> = ({}) => {

  return (
    <nav className="light-bg py-1 w-full">
      <div className="flex items-center">
        <div className="flex mx-5">
          {/* Custom Cardano Wallet Connector */}
          <CardanoWallet />
        </div>

        <div className="flex-grow"></div>
        {/* Links */}
        <div className='dark-text blue-text-hover font-bold py-1 px-4 mx-2 h-8 hidden md:block'>
          <Link href='/'>seedelf</Link>
        </div>
      </div>
    </nav>
  );
};

export default NavBar;
