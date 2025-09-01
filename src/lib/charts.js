import {
    Chart, ArcElement, BarElement, LineElement, PointElement,
    CategoryScale, LinearScale, TimeScale, Tooltip, Legend
  } from 'chart.js';
  
  Chart.register(ArcElement, BarElement, LineElement, PointElement, 
    CategoryScale, LinearScale, TimeScale, Tooltip, Legend);
 
export default Chart;
  