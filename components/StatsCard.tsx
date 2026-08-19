import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatsCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  color: 'blue' | 'emerald' | 'violet' | 'amber';
}

export const StatsCard: React.FC<StatsCardProps> = ({ label, value, icon: Icon, trend, color }) => {
  const styles = {
    blue: { bg: 'bg-blue-50', text: 'text-blue-600', gradient: 'from-blue-500 to-indigo-500', shadow: 'shadow-blue-500/20' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', gradient: 'from-emerald-400 to-teal-500', shadow: 'shadow-emerald-500/20' },
    violet: { bg: 'bg-violet-50', text: 'text-violet-600', gradient: 'from-violet-500 to-purple-500', shadow: 'shadow-violet-500/20' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-600', gradient: 'from-amber-400 to-orange-500', shadow: 'shadow-amber-500/20' },
  };

  const currentStyle = styles[color];

  return (
    <div className="group bg-white p-6 rounded-3xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 hover:-translate-y-1 relative overflow-hidden">
      {/* Background decoration */}
      <div className={`absolute -right-6 -top-6 w-24 h-24 rounded-full bg-gradient-to-br ${currentStyle.gradient} opacity-5 group-hover:opacity-10 transition-opacity duration-500 blur-2xl`}></div>
      
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">{label}</p>
          <h3 className="text-3xl font-extrabold text-slate-900 tracking-tight">{value}</h3>
        </div>
        <div className={`p-3.5 rounded-2xl bg-gradient-to-br ${currentStyle.gradient} text-white shadow-lg ${currentStyle.shadow} transform group-hover:scale-110 transition-transform duration-300`}>
          <Icon size={22} strokeWidth={2.5} />
        </div>
      </div>
      
      <div className="relative mt-4 pt-4 border-t border-slate-50 flex items-center justify-between">
         {trend ? (
            <p className="text-xs font-bold text-emerald-600 flex items-center bg-emerald-50 px-2 py-1 rounded-lg">
              <span className="mr-1">↗</span> {trend}
            </p>
         ) : (
            <div className="h-5"></div>
         )}
         <span className="text-[10px] font-medium text-slate-300">Last 24h</span>
      </div>
    </div>
  );
};