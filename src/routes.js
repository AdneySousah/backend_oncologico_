import { Router } from "express";

import multer from 'multer';
import multerConfig from './config/multer.cjs';

import authMiddleware from "./middlewares/auth.js";
import checkPermission from "./middlewares/checkPermission.js"; // Importe o novo middleware

import UserController from "./app/controllers/UserController.js";
import SessionController from "./app/controllers/SessionController.js";
import OperadoraController from "./app/controllers/OperadoraController.js";
import PacientesController from "./app/controllers/PacientesController.js";
import EvaluationBuilderController from "./app/controllers/EvaluationBuilderController.js";
import EvaluationResponseController from './app/controllers/EvaluationResponseController.js';
import TermoController from './app/controllers/TermoController.js';
import PerfilController from "./app/controllers/PerfilController.js";
import MonitoramentoMedicamentoController from "./app/controllers/MonitoramentoMedicamentoController.js";
import ReacaoAdversaController from "./app/controllers/ReacaoAdversaController.js";
import DashboardController from "./app/controllers/DashboardController.js";
import PasswordResetController from "./app/controllers/PasswordResetController.js";
import AuditLogController from "./app/controllers/AuditLogController.js";

import NpsController from "./app/controllers/NpsController.js";
import NpsHealthController from "./app/controllers/NpsHealthController.js";
import ChatController from "./app/controllers/ChatController.js";
import FaturamentoController from "./app/controllers/FaturamentoController.js";
import MotivoFalhaContatoController from "./app/controllers/MotivoFalhaContatoController.js";
import MotivoPausaTratamentoController from "./app/controllers/MotivoPausaTratamentoController.js";
import AssistenteCalculoController from "./app/controllers/AssistenteCalculoController.js";

import ReservaEdicaoController from "./app/controllers/ReservaEdicaoController.js";


const router = Router();

const upload = multer(multerConfig);


router.post('/session', SessionController.store)

router.post('/nps/manual',  NpsController.manualSubmit); // <-- ADICIONE ESTA LINHA
router.get('/nps/paciente/:paciente_id/atendimento/:monitoramento_id', NpsController.verifyNpsPatient);
router.post('/nps/paciente/:paciente_id/atendimento/:monitoramento_id/responder', NpsController.answerNps);



/* rota publica chat ativo */
router.post('/webhooks/twilio/whatsapp', ChatController.receiveWebhook);
// Rota Pública (O paciente clica no link do zap e essa rota não pode ter authMiddleware)
router.post('/termos/paciente/:id', TermoController.answerTerm);

router.get('/pacientes/:id', TermoController.verifyResponse);
router.get('/termos/paciente/:id/preview-pdf', TermoController.previewPdf);




router.post('/forgot-password', PasswordResetController.forgotPassword);
router.post('/verify-code', PasswordResetController.verifyCode);
router.post('/reset-password', PasswordResetController.resetPassword);


// ==========================================
// 1ª CAMADA DE SEGURANÇA: EXIGE LOGIN VÁLIDO
// ==========================================
router.post('/users'/* , checkPermission('usuarios', 'editar') */, UserController.store);
router.use(authMiddleware)



// --- ROTAS DE USUÁRIOS E PERFIS ---
router.put('/users/first-access', UserController.changeFirstPassword)
router.get('/users/me', UserController.profile);
router.get('/users', checkPermission('usuarios', 'acessar'), UserController.index);
router.put('/users/:id', checkPermission('usuarios', 'editar'), UserController.update);
router.delete('/users/:id', checkPermission('usuarios', 'excluir'), UserController.delete);


// Vinculei os perfis à permissão de 'usuarios' pois fazem parte do mesmo contexto administrativo
router.post('/perfis', checkPermission('usuarios', 'editar'), PerfilController.store);
router.get('/perfis', checkPermission('usuarios', 'acessar'), PerfilController.index);
router.get('/perfis/:id', checkPermission('usuarios', 'acessar'), PerfilController.show);
router.put('/perfis/:id', checkPermission('usuarios', 'editar'), PerfilController.update);


// --- ROTAS DE OPERADORAS ---
router.post('/operadoras', checkPermission('operadoras', 'editar'), OperadoraController.store);
router.get('/operadoras', checkPermission('operadoras', 'acessar'), OperadoraController.index);
router.put('/operadoras/:id', checkPermission('operadoras', 'editar'), OperadoraController.update);
router.patch('/operadoras/:id/status', checkPermission('operadoras', 'editar'), OperadoraController.toggleActive);


// --- ROTAS DOS PACIENTES ---
// Cadastro/edição manual de paciente não existe mais: pacientes vêm só via sincronização
// externa (rotas abaixo). Mantidos apenas os endpoints que a "Necessidade de Navegação"
// e a "Nova Avaliação" realmente consomem.
router.post('/pacientes/sync', checkPermission('pacientes', 'editar'), PacientesController.syncExternal);
router.get('/pacientes/detalhes/:id', checkPermission('pacientes', 'acessar'), PacientesController.show);
router.get('/pacientes/:id/medicamentos-ativos', checkPermission('pacientes', 'acessar'), PacientesController.medicamentosAtivos);
router.post('/pacientes/:id/sync-individual', checkPermission('pacientes', 'editar'), PacientesController.syncIndividual);
router.get('/sync/pacientes/check', checkPermission('pacientes', 'acessar'), PacientesController.checkSync);
router.patch('/pacientes/:id/pausar-tratamento', checkPermission('pacientes', 'editar'), PacientesController.pausarTratamento);
router.patch('/pacientes/:id/retomar-tratamento', checkPermission('pacientes', 'editar'), PacientesController.retomarTratamento);


// --- ROTAS DE AVALIAÇÕES (QUESTIONÁRIOS) ---
router.post('/evaluations/templates', checkPermission('avaliacoes', 'editar'), EvaluationBuilderController.store);
router.patch('/evaluations/templates/:id/status', checkPermission('avaliacoes', 'editar'), EvaluationBuilderController.toggleStatus);
router.get('/evaluations/templates', checkPermission('avaliacoes', 'acessar'), EvaluationBuilderController.index);

// Rota de buscar os pendentes do paciente
router.get('/evaluations/templates/pending/:paciente_id', checkPermission('avaliacoes', 'acessar'), EvaluationBuilderController.getPendingForPatient);

// NOVA ROTA AQUI: Buscar um template específico pelo ID (deve ficar abaixo da rota de pending!)
router.get('/evaluations/templates/:id', checkPermission('avaliacoes', 'acessar'), EvaluationBuilderController.show);

router.put('/evaluations/templates/:id', checkPermission('avaliacoes', 'editar'), EvaluationBuilderController.update);

// Rotas de respostas e histórico
router.post('/evaluations/responses', checkPermission('avaliacoes', 'editar'), EvaluationResponseController.store);
router.get('/evaluations/responses', checkPermission('avaliacoes', 'acessar'), EvaluationResponseController.index);
router.get('/evaluations/paciente/:paciente_id/history', EvaluationResponseController.history);
router.get('/evaluations/pendentes-alerta', EvaluationResponseController.pendentesAlerta);

// --- TIMELINE DE AVALIAÇÕES ---
router.get('/avaliacoes',  EvaluationResponseController.index);


// --- ROTAS DE TERMOS ---
router.post('/termos/send', checkPermission('termos', 'editar'), TermoController.sendLink);
router.get('/termos/paciente/:id/status', checkPermission('termos', 'acessar'), TermoController.checkStatus);

router.post('/nps/send', checkPermission('avaliacoes', 'editar'), NpsController.sendNps); 
router.get('/nps', checkPermission('dashboard', 'acessar'), NpsController.index); 
router.get('/nps/paciente/:id/atendimento/:monitoramento_id/status', NpsController.checkPatientStatus);



// Rotas de monitoramento

router.post('/monitoramento-medicamentos', checkPermission('telemonitoramento', 'editar'), MonitoramentoMedicamentoController.store);
router.get('/monitoramento-medicamentos/pendentes', checkPermission('telemonitoramento', 'acessar'), MonitoramentoMedicamentoController.index);
router.get('/monitoramento-medicamentos/candidatos-retomada', checkPermission('telemonitoramento', 'acessar'), MonitoramentoMedicamentoController.candidatosRetomada);
router.get('/monitoramento/timeline', MonitoramentoMedicamentoController.timeline);

router.put('/monitoramento-medicamentos/vincular-avaliacao', MonitoramentoMedicamentoController.vincularAvaliacaoSilencioso);


// Rotas de sincronização em tempo real do evento atual
router.get('/monitoramento-medicamentos/:id/historico-aberturas', MonitoramentoMedicamentoController.historicoAberturas);
router.get('/monitoramento-medicamentos/:id/historico-compras', MonitoramentoMedicamentoController.historicoCompras);
router.get('/monitoramento-medicamentos/:id/verificar-sincronizacao-atual', MonitoramentoMedicamentoController.verificarSincronizacaoAtual);
router.put('/monitoramento-medicamentos/:id/confirmar-sincronizacao-atual', MonitoramentoMedicamentoController.confirmarSincronizacaoAtual);
router.get('/monitoramento-medicamentos/:id/verificar-compra', MonitoramentoMedicamentoController.verificarNovaCompra);
router.put('/monitoramento-medicamentos/:id/data-administracao', checkPermission('telemonitoramento', 'editar'), MonitoramentoMedicamentoController.informarDataAdministracao);
router.put('/monitoramento-medicamentos/:id', checkPermission('telemonitoramento', 'editar'), MonitoramentoMedicamentoController.update);
router.put('/monitoramento-medicamentos/:id/reembolso', checkPermission('telemonitoramento', 'editar'), MonitoramentoMedicamentoController.criarEventoReembolso);
router.put('/monitoramento-medicamentos/conjunto/registrar', MonitoramentoMedicamentoController.registrarContatoConjunto);
router.put('/monitoramento-medicamentos/:id/data-proximo-contato', checkPermission('telemonitoramento', 'editar'), MonitoramentoMedicamentoController.atualizarDataProximoContato);
router.get('/monitoramento-medicamentos/recalculaveis', checkPermission('recalculo', 'acessar'), MonitoramentoMedicamentoController.listarRecalculaveis);
router.put('/monitoramento-medicamentos/:id/recalcular', checkPermission('recalculo', 'editar'), MonitoramentoMedicamentoController.recalcular);

// Buscar detalhes de um monitoramento específico (necessário para carregar o modal de edição)
router.get('/monitoramento-medicamentos/:id', checkPermission('telemonitoramento', 'acessar'), MonitoramentoMedicamentoController.show);

// Edição retroativa de um contato já concluído
router.put('/monitoramento-medicamentos/:id/edicao-retroativa', checkPermission('telemonitoramento', 'editar'), MonitoramentoMedicamentoController.updateRetroativo);

/* Rotas de ficha ram */
router.post('/reacao-adversa', checkPermission('reacao_adversa', 'editar'), ReacaoAdversaController.store);
router.get('/reacao-adversa', checkPermission('reacao_adversa', 'acessar'), ReacaoAdversaController.index);
router.put('/reacao-adversa/:id', ReacaoAdversaController.update);
router.delete('/reacao-adversa/:id', ReacaoAdversaController.delete);
router.post('/reacao-adversa/validate', checkPermission('reacao_adversa', 'editar'), upload.single('file'), ReacaoAdversaController.validateExcel);
router.post('/reacao-adversa/import', checkPermission('reacao_adversa', 'editar'), upload.single('file'), ReacaoAdversaController.importExcel);


router.get('/dashboard', checkPermission('dashboard', 'acessar'), DashboardController.index);
router.post('/dashboard/fechar-mes', checkPermission('dashboard', 'editar'), DashboardController.fecharMes);
router.get('/dashboard/status-fechamento-mes-anterior', checkPermission('fechar_mes_dashboard', 'acessar'), DashboardController.statusFechamentoMesAnterior);
router.post('/dashboard/fechar-mes-anterior', checkPermission('fechar_mes_dashboard', 'editar'), DashboardController.fecharMesAnterior);


router.get('/audit-logs',checkPermission('audit-logs', 'acessar'), AuditLogController.index);

router.get('/nps/health',checkPermission('check-saude', 'acessar'), NpsHealthController.checkStatus);



router.get('/chat/conversations', checkPermission('chat', 'acessar'), ChatController.listConversations);
router.get('/chat/conversations/:id', checkPermission('chat', 'acessar'), ChatController.getHistory);
router.post('/chat/send', checkPermission('chat', 'editar'), ChatController.sendMessage);
router.post('/chat/reopen', checkPermission('chat', 'editar'), ChatController.reopenWindow);
router.get('/chat/unread', checkPermission('chat', 'acessar'), ChatController.getUnreadCounts);
router.delete('/chat/conversations/:id', checkPermission('chat', 'excluir'), ChatController.deleteConversation);


router.get('/faturamento', FaturamentoController.index);


router.get('/termos-anexos/todos', checkPermission('termo', 'acessar'), TermoController.listarTermosAceitos);
router.get('/termos/versoes', checkPermission('termo', 'acessar'), TermoController.listarVersoesTermo);
router.post('/termos/versoes', checkPermission('termo', 'editar'), TermoController.criarVersaoTermo);



// ==========================================
// ROTAS: Motivos de Falha de Contato
// ==========================================
router.get('/motivos-falha-contato', MotivoFalhaContatoController.index);
router.post('/motivos-falha-contato', MotivoFalhaContatoController.store);
router.put('/motivos-falha-contato/:id', MotivoFalhaContatoController.update);
router.delete('/motivos-falha-contato/:id', MotivoFalhaContatoController.delete);

// ==========================================
// ROTAS: Motivos de Pausa/Descontinuação de Tratamento
// (compartilhado entre Necessidade de Navegação e Telemonitoramento)
// ==========================================
router.get('/motivos-pausa-tratamento', MotivoPausaTratamentoController.index);
router.post('/motivos-pausa-tratamento', MotivoPausaTratamentoController.store);
router.put('/motivos-pausa-tratamento/:id', MotivoPausaTratamentoController.update);
router.delete('/motivos-pausa-tratamento/:id', MotivoPausaTratamentoController.delete);



// ==========================================
// ROTAS: Reserva de Edição de Monitoramento de Medicamentos
// ==========================================
router.post('/monitoramento-medicamentos/paciente/:pacienteId/reserva-edicao', checkPermission('telemonitoramento', 'editar'), ReservaEdicaoController.reservar);
router.delete('/monitoramento-medicamentos/paciente/:pacienteId/reserva-edicao', checkPermission('telemonitoramento', 'editar'), ReservaEdicaoController.liberar);

// ==========================================
// ROTAS: Assistente de Cálculo
// ==========================================

router.post('/assistente-calculo', checkPermission('telemonitoramento', 'acessar'), AssistenteCalculoController.calcular);




export default router;
