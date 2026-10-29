import { useParams } from 'react-router-dom';
import { useCrumbs } from '../App';

export function ImportExportPage() {
  const { projectId } = useParams();
  useCrumbs([{ label: 'Project', to: `/projects/${projectId}` }, { label: 'Import / export' }]);
  return <div className="page">Import and export are being built.</div>;
}
