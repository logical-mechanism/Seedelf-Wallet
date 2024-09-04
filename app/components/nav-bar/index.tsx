import { CardanoWallet } from "./cardano-wallet";


const NavBar: React.FC = () => {

  return (
    <nav className="light-bg py-1 w-full">
      <div className="flex items-center">
        <div className="flex mx-5">
          <CardanoWallet />
        </div>
        <div className="flex-grow"></div>
        <div className='dark-text font-bold py-1 px-4 mx-2 h-8 hidden md:block'>
          <p>Seedelf Wallet</p>
        </div>
      </div>
    </nav>
  );
};

export default NavBar;
