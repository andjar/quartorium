import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import EditorPage from './pages/EditorPage';
import CollabEditorPage from './pages/CollabEditorPage';
import ReviewPage from './pages/ReviewPage';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <div className="App">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/editor" element={<EditorPage />} />
          <Route path="/collab/:shareToken" element={<CollabEditorPage />} />
          <Route path="/review/:shareToken" element={<ReviewPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;