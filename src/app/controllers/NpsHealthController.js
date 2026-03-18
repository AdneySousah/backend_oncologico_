// app/controllers/NpsHealthController.js
import { getWhatsappStatus } from '../../services/NpsService.js';

class NpsHealthController {
    async checkStatus(req, res) {
        try {
            const status = await getWhatsappStatus();
            
            if (!status) {
                return res.status(500).json({ error: 'Não foi possível consultar a Twilio' });
            }

            return res.json(status);
        } catch (error) {
            return res.status(500).json({ error: 'Erro interno no servidor' });
        }
    }
}

export default new NpsHealthController();