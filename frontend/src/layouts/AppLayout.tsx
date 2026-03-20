import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import '../styles/AppLayout.css';

export const AppLayout = () => {
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-layout__main">
        <main className="app-layout__content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
