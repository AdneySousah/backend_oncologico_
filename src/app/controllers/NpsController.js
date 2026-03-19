import Pacientes from '../models/Pacientes.js';
import NpsResponse from '../models/NpsResponse.js';
import { Op } from 'sequelize';
import AuditService from '../../services/AuditService.js';
import { enviarEnqueteNPS } from '../../services/whatsapp.js';

class NpsController {
    /**
     * 1. DISPARO DO NPS (Chamado pelo sistema/atendente)
     */
    async sendNps(req, res) {
        const { paciente_id } = req.body;

        try {
            const paciente = await Pacientes.findByPk(paciente_id);

            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            const numeroDestino = paciente.celular || paciente.telefone;
            
            if (!numeroDestino) {
                return res.status(400).json({ error: 'Paciente não possui número cadastrado' });
            }

            // Dispara via Twilio Service (O número já vai formatado com 55 lá)
            const enviado = await enviarEnqueteNPS(numeroDestino, paciente.nome);

            if (!enviado) {
                return res.status(500).json({ error: 'Falha ao enviar NPS via Twilio' });
            }

            await AuditService.log(
                req.userId, 
                'Envio', 
                'NPS WhatsApp', 
                paciente.id, 
                `Enviou pesquisa de NPS via WhatsApp para o número ${numeroDestino}`
            );
            
            return res.json({ message: 'Pesquisa de NPS enviada com sucesso!' });

        } catch (error) {
            console.error("Erro ao enviar NPS:", error);
            return res.status(500).json({ error: 'Erro interno no servidor' });
        }
    }

   async registerResponse(req, res) {
    // A Twilio envia os dados no corpo (req.body)
    const { From, Body } = req.body; 

    try {
        // 1. Garantir que From existe e tratá-lo como String
        if (!From) {
            return res.status(200).send('<Response></Response>');
        }
        const stringFrom = String(From);
        const celularLimpo = stringFrom.replace('whatsapp:', '').replace(/\D/g, '');

        // 2. Garantir que Body seja tratado como String para o Regex funcionar
        // Se você mandou 10 (número) no Postman, o String(Body) vira "10" (texto)
        const stringBody = Body ? String(Body) : '';
        const match = stringBody.match(/\b(10|[0-9])\b/);
        
        if (!match) {
            console.warn(`⚠️ Resposta de ${celularLimpo} sem nota válida: "${Body}"`);
            res.set('Content-Type', 'text/xml');
            return res.status(200).send('<Response></Response>');
        }

        const notaFinal = parseInt(match[0]);

        // 3. Busca Inteligente (últimos 8 dígitos)
        const ultimos8 = celularLimpo.slice(-8);
        const paciente = await Pacientes.findOne({
            where: {
                celular: { [Op.like]: `%${ultimos8}` }
            }
        });

        if (!paciente) {
            console.error(`❌ Voto de ${celularLimpo} ignorado: Paciente não localizado.`);
            res.set('Content-Type', 'text/xml');
            return res.status(200).send('<Response></Response>');
        }

        // 4. Salva no banco
        await NpsResponse.create({
            paciente_id: paciente.id,
            nota: notaFinal
        });

        console.log(`✅ NPS Registrado: ${paciente.nome} deu nota ${notaFinal}`);

        // 5. Resposta TwiML
        res.set('Content-Type', 'text/xml');
        return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
            <Response>
                <Message>A CICFARMA agradece o seu feedback! Sua nota ${notaFinal} foi registrada com sucesso.</Message>
            </Response>`);

    } catch (error) {
        console.error("❌ Erro crítico no Webhook da Twilio:", error);
        res.set('Content-Type', 'text/xml');
        return res.status(200).send('<Response></Response>');
    }
  }

    /**
     * 3. RELATÓRIO DE NPS (Dashboard)
     */
    async index(req, res) {
        try {
            const npsData = await NpsResponse.findAll({
                // Incluímos o ID do paciente para você saber de quem é a nota, se precisar
                attributes: ['id', 'paciente_id', 'nota', 'created_at'],
                order: [['created_at', 'DESC']]
            });

            const total = npsData.length;
            if (total === 0) return res.json({ resumo: { total_respostas: 0 }, dados: [] });

            let promotores = 0;
            let detratores = 0;
            let somaNotas = 0;

            npsData.forEach(resp => {
                somaNotas += resp.nota;
                if (resp.nota >= 9) promotores++;
                else if (resp.nota <= 6) detratores++;
            });

            const scoreNps = Math.round(((promotores - detratores) / total) * 100);
            const mediaReal = (somaNotas / total).toFixed(1);

            return res.json({
                resumo: { 
                    total_respostas: total, 
                    score_nps: scoreNps, 
                    media_real: Number(mediaReal)
                },
                dados: npsData // Aqui estão as notas individuais (10, 8, 5...)
            });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao buscar dados do NPS' });
        }
    }

    /**
     * 4. VERIFICAÇÃO DE DUPLICIDADE (Evita o paciente votar 10x seguidas)
     */
    async checkPatientStatus(req, res) {
        const { id } = req.params;
        
        // Vamos diminuir a janela para 2 minutos. 
        // Assim, o Modal só "valida" se a resposta for muito recente.
        const limiteTempo = new Date();
        limiteTempo.setMinutes(limiteTempo.getMinutes() - 2); 

        try {
            const nps = await NpsResponse.findOne({
                where: {
                    paciente_id: id,
                    created_at: { [Op.gte]: limiteTempo } // Só pega se foi nos últimos 2 minutos
                },
                order: [['created_at', 'DESC']]
            });

            return res.json({ 
                respondido: !!nps, 
                nota: nps ? nps.nota : null 
            });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao verificar status' });
        }
    }
}
export default new NpsController();