import Pacientes from '../models/Pacientes.js';
import User from '../models/User.js';
import { enviarMensagemWhatsApp } from '../../services/whatsapp.js';
import AuditService from '../../services/AuditService.js';
import { gerarPdfTermoNavegacao } from '../../utils/gerarTermoPdf.js';
import TermosHistorico from '../models/TermosHistorico.js';
import path from 'path';
import Mail from '../../services/Mail.js';
import PacienteTermoAnexo from '../models/PacienteTermoAnexo.js';

class TermoController {


    async sendLink(req, res) {
        const { paciente_id, telefone_destino, destino_tipo, email_destino } = req.body;

        try {
            const user = await User.findByPk(req.userId);
            const paciente = await Pacientes.findByPk(paciente_id, {
                include: ['operadoras']
            });

            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            const frontUrl = process.env.FRONT_URL || 'http://localhost:3000';
            const linkAcompanhamento = `${frontUrl}/paciente/termo/${paciente.id}`;

            // ==========================================
            // FLUXO DE DISPARO POR E-MAIL
            // ==========================================
            if (destino_tipo === 'email') {
                if (!email_destino) {
                    return res.status(400).json({ error: 'E-mail não informado.' });
                }

                // Atualiza o e-mail no cadastro se for diferente do atual
                if (paciente.email !== email_destino) {
                    paciente.email = email_destino;
                }
                
                paciente.status_termo = 'Pendente';
                await paciente.save();

                const operadoraNome = paciente.operadoras?.nome || 'nossa equipe de saúde';
                
                const htmlContent = `
                    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
                        <h2>Olá, ${paciente.nome}!</h2>
                        <p>Meu nome é ${user.name} e estou entrando em contato em nome da <strong>${operadoraNome}</strong>.</p>
                        <p>Precisamos que você leia e aceite os termos de contato para podermos te acompanhar durante o seu tratamento.</p>
                        <p>Por favor, acesse o link abaixo para visualizar e responder ao termo:</p>
                        <div style="margin: 20px 0;">
                            <a href="${linkAcompanhamento}" style="background-color: #0056b3; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                                Acessar Termo de Acompanhamento
                            </a>
                        </div>
                        <p>Se o botão não funcionar, copie e cole este link no seu navegador:</p>
                        <p><a href="${linkAcompanhamento}">${linkAcompanhamento}</a></p>
                        <p>Agradecemos a sua atenção!</p>
                    </div>
                `;

                await Mail.sendMail({
                    to: email_destino,
                    subject: 'Termos de Acompanhamento',
                    html: htmlContent
                });

                await AuditService.log(
                    req.userId,
                    'Envio',
                    'Termo E-mail',
                    paciente.id,
                    `Disparou o termo de acompanhamento por e-mail para ${email_destino}.`
                );

                return res.json({ message: 'Link enviado por e-mail com sucesso!' });
            }

            // ==========================================
            // FLUXO DE DISPARO VIA WHATSAPP (Twilio)
            // ==========================================
            const numeroDestino = telefone_destino || paciente.celular || paciente.telefone;

            if (!numeroDestino) {
                return res.status(400).json({ error: 'Nenhum número de destino informado ou cadastrado.' });
            }

            // Validação estrita: DDD e Dígito 9
            let numeroLimpo = String(numeroDestino).replace(/\D/g, '');
            
            if (numeroLimpo.startsWith('55') && numeroLimpo.length >= 13) {
                numeroLimpo = numeroLimpo.substring(2);
            }

            if (numeroLimpo.length !== 11 || numeroLimpo[2] !== '9') {
                return res.status(400).json({ 
                    error: 'Número inválido para envio. O número deve conter o DDD e o dígito 9. Ex: (31) 98888-8888' 
                });
            }

            paciente.status_termo = 'Pendente';
            await paciente.save();

            const enviado = await enviarMensagemWhatsApp(
                numeroDestino,
                paciente.nome,
                paciente.operadoras?.nome || 'sua operadora',
                user.name,
                linkAcompanhamento,
                req.userId
            );

            if (!enviado) {
                return res.status(500).json({ error: 'Falha ao enviar mensagem via WhatsApp' });
            }

            let nomeDestinoFinal = paciente.nome;
            let papelDestino = 'Paciente';

            if (destino_tipo === 'cuidador') {
                nomeDestinoFinal = paciente.nome_cuidador || 'Não informado';
                papelDestino = 'Cuidador/Responsável';
            } else if (destino_tipo === 'manual') {
                nomeDestinoFinal = 'Número inserido manualmente pelo operador';
                papelDestino = 'Contato Manual/Avulso';
            }

            const mensagemLog = `Disparou o termo de acompanhamento para o(a) ${papelDestino} (${nomeDestinoFinal}) no número ${numeroDestino}.`;

            await AuditService.log(
                req.userId,
                'Envio',
                'Termo WhatsApp',
                paciente.id,
                mensagemLog
            );

            return res.json({ message: 'Link enviado com sucesso!' });

        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Erro interno no servidor' });
        }
    }

    // Acessado publicamente pelo paciente clicando no link

    async answerTerm(req, res) {
    const { id } = req.params;
    const { aceite } = req.body; // boolean

    try {
        const paciente = await Pacientes.findByPk(id);

        if (!paciente) {
            return res.status(404).json({ error: 'Paciente não encontrado' });
        }

        // Atualiza os dados principais
        paciente.status_termo = aceite ? 'Aceito' : 'Recusado';

        let pdfSalvoPath = null;
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const userAgent = req.headers['user-agent'];

        if (aceite) {
            // Gera o PDF e salva fisicamente no servidor (uploads/anexos)
            pdfSalvoPath = await gerarPdfTermoNavegacao(paciente);

            // Grava os rastros no cadastro do paciente
            paciente.termo_data_aceite = new Date();
            paciente.termo_ip = ip;
            paciente.termo_user_agent = userAgent;
            paciente.termo_versao = '1.0';
        } else {
            paciente.termo_data_aceite = null;
            paciente.termo_ip = null;
            paciente.termo_user_agent = null;
            paciente.termo_versao = null;
        }

        await paciente.save();

        // Salva o registro imutável na tabela de histórico
        await TermosHistorico.create({
            paciente_id: paciente.id,
            status: paciente.status_termo,
            arquivo_path: pdfSalvoPath ? path.basename(pdfSalvoPath) : null,
            ip: ip,
            user_agent: userAgent
        });

        // =================================================================
        // 👇 NOVO: GRAVAÇÃO AUTOMÁTICA NA TABELA 'paciente_termos_anexos'
        // =================================================================
        if (aceite && pdfSalvoPath) {
            const nomeArquivo = path.basename(pdfSalvoPath);
            
            await PacienteTermoAnexo.create({
                paciente_id: paciente.id,
                arquivo_path: nomeArquivo,
                nome_original: `Termo_Navegacao_${paciente.nome.trim().replace(/\s+/g, '_')}.pdf`
            });
        }
        // =================================================================

        return res.json({ 
            message: 'Resposta registrada com sucesso', 
            status_termo: paciente.status_termo,
            termo_data_aceite: paciente.termo_data_aceite
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Erro ao processar resposta' });
    }
}

    async verifyResponse(req, res) {
        const { id } = req.params;
        try {
            const paciente = await Pacientes.findByPk(id, {
                include: ['operadoras'],
                // ✅ NOVO: Adicionado 'termo_data_aceite' nos atributos retornados
                attributes: ['id', 'status_termo', 'termo_data_aceite'] 
            });
            
            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }
            
            return res.json({ paciente });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao checar status' });
        }
    }

    // Método para o frontend consultar o status em tempo real (Polling)
    async checkStatus(req, res) {
        const { id } = req.params;
        try {
            const paciente = await Pacientes.findByPk(id, { attributes: ['id', 'status_termo'] });
            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }
            return res.json({ status_termo: paciente.status_termo });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao checar status' });
        }
    }

    async verifyResponse(req, res) {
        const { id } = req.params
        try {
            const paciente = await Pacientes.findByPk(id,
                {
                    include: ['operadoras'],
                    attributes: ['id', 'status_termo']
                }
            );
            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }
            return res.json({ paciente });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao checar status' });
        }
    }

    async previewPdf(req, res) {
        const { id } = req.params;
        try {
            const paciente = await Pacientes.findByPk(id);
            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            // Passa o "res" para a função. Ela vai gerar e enviar direto para o navegador
            await gerarPdfTermoNavegacao(paciente, res);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Erro ao gerar visualização do termo' });
        }
    }
}

export default new TermoController();