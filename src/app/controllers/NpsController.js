import Pacientes from '../models/Pacientes.js';
import NpsResponse from '../models/NpsResponse.js';
import { Op } from 'sequelize';
import AuditService from '../../services/AuditService.js';
import { enviarLinkNPS } from '../../services/whatsapp.js';

class NpsController {
    /**
     * 1. DISPARO DO NPS (Chamado pelo sistema/atendente)
     */
    async sendNps(req, res) {
        const { paciente_id, telefone_destino, destino_tipo, monitoramento_id } = req.body;

        try {
            const paciente = await Pacientes.findByPk(paciente_id, {
                include: ['operadoras']
            });

            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            const numeroDestino = telefone_destino || paciente.celular || paciente.telefone;

            if (!numeroDestino) {
                return res.status(400).json({ error: 'Paciente/Cuidador não possui número cadastrado' });
            }

            // Geração do Link Front-end
            const frontUrl = process.env.FRONT_URL || 'http://localhost:3000';
            const linkNps = `${frontUrl}/paciente/nps/${paciente.id}/${monitoramento_id}`;

            // Dispara via Twilio usando uma mensagem de texto com o link
            const enviado = await enviarLinkNPS(
                numeroDestino,
                paciente.nome,
                paciente.operadoras.nome,
                req.userId,
                linkNps // Passando a URL construída
            );

            if (!enviado) {
                return res.status(500).json({ error: 'Falha ao enviar NPS via Twilio' });
            }

            // Lógica de log mantida
            const nomeDestinoFinal = destino_tipo === 'cuidador' && paciente.nome_cuidador
                ? paciente.nome_cuidador
                : paciente.nome;
            const papelDestino = destino_tipo === 'cuidador' ? 'Cuidador/Responsável' : 'Paciente';

            const mensagemLog = `Disparou o link da pesquisa NPS via WhatsApp para o(a) ${papelDestino} (${nomeDestinoFinal}) no número ${numeroDestino}.`;

            await AuditService.log(
                req.userId,
                'Envio',
                'NPS WhatsApp',
                paciente.id,
                mensagemLog
            );

            return res.json({ message: 'Link de pesquisa de NPS enviado com sucesso!' });

        } catch (error) {
            console.error("Erro ao enviar NPS:", error);
            return res.status(500).json({ error: 'Erro interno no servidor' });
        }
    }


    async registerResponse(req, res) {
        const { From, Body } = req.body;

        try {
            if (!From) {
                return res.status(200).send('<Response></Response>');
            }
            const stringFrom = String(From);
            const celularLimpo = stringFrom.replace('whatsapp:', '').replace(/\D/g, '');

            const stringBody = Body ? String(Body) : '';
            const match = stringBody.match(/\b(10|[0-9])\b/);

            if (!match) {
                console.warn(`⚠️ Resposta de ${celularLimpo} sem nota válida: "${Body}"`);
                res.set('Content-Type', 'text/xml');
                return res.status(200).send('<Response></Response>');
            }

            const notaFinal = parseInt(match[0]);

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

            await NpsResponse.create({
                paciente_id: paciente.id,
                nota: notaFinal
            });


            res.set('Content-Type', 'text/xml');
            return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
            <Response>
                <Message>Agradecemos o seu feedback! Sua nota ${notaFinal} foi registrada com sucesso.</Message>
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
                dados: npsData
            });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao buscar dados do NPS' });
        }
    }

    /**
     * 4. VERIFICAÇÃO DE DUPLICIDADE (Evita o paciente votar 10x seguidas)
     */
    async checkPatientStatus(req, res) {
        const { id, monitoramento_id } = req.params;

        const limiteTempo = new Date();
        limiteTempo.setMinutes(limiteTempo.getMinutes() - 2);

       try {
            // Procura se tem NPS para aquele monitoramento específico
            const nps = await NpsResponse.findOne({
                where: {
                    paciente_id: id,
                    monitoramento_id: monitoramento_id
                }
            });

            return res.json({ 
                respondido: !!nps, 
                nota: nps ? nps.nota : null 
            });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao verificar status' });
        }
    }

    async answerNps(req, res) {
        const { paciente_id, monitoramento_id } = req.params;
        const { nota } = req.body;

        try {
            // ✅ CORRIGIDO: Usando paciente_id no lugar de id
            const paciente = await Pacientes.findByPk(paciente_id);

            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            const notaFinal = parseInt(nota);

            if (isNaN(notaFinal) || notaFinal < 0 || notaFinal > 10) {
                return res.status(400).json({ error: 'Nota inválida fornecida' });
            }

            await NpsResponse.create({
                paciente_id: paciente_id,
                monitoramento_id: monitoramento_id,
                nota: notaFinal // ✅ CORRIGIDO: Reaproveitando a variável já convertida
            });

            return res.json({ message: 'Agradecemos o seu feedback! Sua nota foi registrada com sucesso.' });

        } catch (error) {
            console.error("Erro ao registrar NPS via link:", error);
            return res.status(500).json({ error: 'Erro ao processar resposta' });
        }
    }

    /**
     * ROTA PÚBLICA: Valida o paciente para a tela de NPS externa
     */
    async verifyNpsPatient(req, res) {
        const { paciente_id, monitoramento_id } = req.params;

        try {
            const paciente = await Pacientes.findByPk(paciente_id, {
                attributes: ['id', 'nome', 'sobrenome']
            });

            if (!paciente) return res.status(404).json({ error: 'Paciente não encontrado' });

            // Verifica se JÁ EXISTE uma nota para ESTE monitoramento específico
            const npsExistente = await NpsResponse.findOne({
                where: {
                    paciente_id: paciente_id,
                    monitoramento_id: monitoramento_id // Exige coluna monitoramento_id no banco
                }
            });

            return res.json({
                paciente,
                ja_respondeu: !!npsExistente // Bloqueia apenas se este atendimento já foi avaliado
            });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao verificar paciente' });
        }
    }
}
export default new NpsController();