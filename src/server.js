import app from "./app.js";
import { iniciarJobFechamentoDashboard } from "./services/DashboardCloseService.js";

const PORT = process.env.PORT || 3002;
iniciarJobFechamentoDashboard()

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});