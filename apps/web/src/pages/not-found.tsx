import { Link } from 'wouter';
import { Compass } from 'lucide-react';
import { EmptyState } from '@/components/common';

export default function NotFound() {
  return (
    <div className="panel mt-10">
      <EmptyState title="Page not found" detail="That screen does not exist in the command centre." icon={Compass} />
      <div className="pb-8 text-center">
        <Link href="/" className="btn btn-primary">
          Back to overview
        </Link>
      </div>
    </div>
  );
}
