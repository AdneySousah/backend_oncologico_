import { Router } from "express";

import multer from 'multer';
import multerConfig from './config/multer.cjs';
import multerConfigAnexos from './config/anexosMulter.cjs';

import authMiddleware from "./middlewares/auth.js";
import checkPermission from "./middlewares/checkPermission.js"; // Importe o novo middleware

import UserController from "./app/controllers/UserController.js";
import OncologyProfessionalController from "./app/controllers/OncologyProfessionalController.js";
import EspecialitesController from "./app/controllers/EspecialitesController.js";
import SessionController from "./app/controllers/SessionController.js";
import OperadoraController from "./app/controllers/OperadoraController.js";
import PacientesController from "./app/controllers/PacientesController.js";
import PrestadorMedicoController from "./app/controllers/PrestadorMedicoController.js";
import DiagnosticoController from "./app/controllers/DiagnosticoController.js";
import ExamesController from "./app/controllers/ExamesController.js";
import InfosComorbidadeController from "./app/controllers/InfosComorbidadeController.js";
import EvaluationBuilderController from "./app/controllers/EvaluationBuilderController.js";
import EvaluationResponseController from './app/controllers/EvaluationResponseController.js';
import MedicoController from "./app/controllers/MedicoController.js";
import ComorbidadesController from "./app/controllers/ComorbidadesController.js";
import MedicamentosController from "./app/controllers/MedicamentosController.js";
import TermoController from './app/controllers/TermoController.js';
import PerfilController from "./app/controllers/PerfilController.js";
import MonitoramentoMedicamentoController from "./app/controllers/MonitoramentoMedicamentoController.js";
import ReacaoAdversaController from "./app/controllers/ReacaoAdversaController.js";
import DashboardController from "./app/controllers/DashboardController.js";
import TentativaContatoController from "./app/controllers/TentativaContatoController.js";
import PasswordResetController from "./app/controllers/PasswordResetController.js";
import AuditLogController from "./app/controllers/AuditLogController.js";

import NpsController from "./app/controllers/NpsController.js";
import NpsHealthController from "./app/controllers/NpsHealthController.js";
import ChatController from "./app/controllers/ChatController.js";




const router = Router();

const upload = multer(multerConfig);
const uploadAnexos = multer(multerConfigAnexos);


router.post('/session', SessionController.store)
router.get('/pacientes/pendentes', authMiddleware, PacientesController.getPending);
/* router.post('/nps/resposta', NpsController.registerResponse); */

/* rota publica chat ativo */
router.post('/webhooks/twilio/whatsapp', ChatController.receiveWebhook);
// Rota Pública (O paciente clica no link do zap e essa rota não pode ter authMiddleware)
router.post('/termos/paciente/:id', TermoController.answerTerm);
router.get('/pacientes/:id', TermoController.verifyResponse);



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


// --- ROTAS DE PROFISSIONAIS ---
router.post('/professionals', checkPermission('profissionais', 'editar'), OncologyProfessionalController.store);
router.get('/professionals', checkPermission('profissionais', 'acessar'), OncologyProfessionalController.index);


// --- ROTAS DE ESPECIALIDADES ---
router.post('/specialities', checkPermission('especialidades', 'editar'), EspecialitesController.store);
router.get('/specialities', checkPermission('especialidades', 'acessar'), EspecialitesController.index);
router.put('/specialities/:id', checkPermission('especialidades', 'editar'), EspecialitesController.update);
router.delete('/specialities/:id', checkPermission('especialidades', 'editar'), EspecialitesController.delete);
router.post('/specialities/validate', checkPermission('especialidades', 'editar'), upload.single('file'), EspecialitesController.validateExcel);
router.post('/specialities/import', checkPermission('especialidades', 'editar'), upload.single('file'), EspecialitesController.importExcel);


// --- ROTAS DE OPERADORAS ---
router.post('/operadoras', checkPermission('operadoras', 'editar'), OperadoraController.store);
router.get('/operadoras', checkPermission('operadoras', 'acessar'), OperadoraController.index);
router.put('/operadoras/:id', checkPermission('operadoras', 'editar'), OperadoraController.update);


// --- ROTAS DOS PACIENTES ---
router.post('/pacientes', checkPermission('pacientes', 'editar'), uploadAnexos.array('anexos_files'), PacientesController.store);
router.get('/pacientes', checkPermission('pacientes', 'acessar'), PacientesController.index);
router.get('/pacientes/detalhes/:id', checkPermission('pacientes', 'acessar'), PacientesController.show);
router.put('/pacientes/:id', checkPermission('pacientes', 'editar'), uploadAnexos.array('anexos_files'), PacientesController.update);
router.post('/pacientes/validate', checkPermission('pacientes', 'editar'), upload.single('file'), PacientesController.validateImport);
router.post('/pacientes/import', checkPermission('pacientes', 'editar'), upload.single('file'), PacientesController.importExcel);
router.get('/anexos/nomes', checkPermission('pacientes', 'acessar'), PacientesController.getNomesAnexos);
router.get('/operadoras/filtro', PacientesController.getOperadorasFiltro);
router.patch('/pacientes/:id/status', checkPermission('pacientes', 'editar'), PacientesController.toggleActive);
router.patch('/pacientes/:id/confirmar', checkPermission('pacientes', 'editar'), PacientesController.confirmPatient);

router.post('/pacientes/autofill', checkPermission('pacientes', 'editar'), upload.single('documento'), PacientesController.autoFillFromDocument);


// --- ROTAS DE PRESTADORES MÉDICOS (HOSPITAIS) ---
router.post('/prestadores-medicos', checkPermission('prestadores_medicos', 'editar'), PrestadorMedicoController.store);
router.get('/prestadores-medicos', checkPermission('prestadores_medicos', 'acessar'), PrestadorMedicoController.index);
router.put('/prestadores-medicos/:id', checkPermission('prestadores_medicos', 'editar'), PrestadorMedicoController.update);
router.delete('/prestadores-medicos/:id', checkPermission('prestadores_medicos', 'editar'), PrestadorMedicoController.delete);
router.post('/prestadores-medicos/validate', checkPermission('prestadores_medicos', 'editar'), upload.single('file'), PrestadorMedicoController.validateExcel);
router.post('/prestadores-medicos/import', checkPermission('prestadores_medicos', 'editar'), upload.single('file'), PrestadorMedicoController.importExcel);


// --- ROTAS DE DIAGNÓSTICOS CID ---
router.post('/diagnosticos', checkPermission('diagnosticos', 'editar'), DiagnosticoController.store);
router.get('/diagnosticos', checkPermission('diagnosticos', 'acessar'), DiagnosticoController.index);
router.put('/diagnosticos/:id', checkPermission('diagnosticos', 'editar'), DiagnosticoController.update);
router.delete('/diagnosticos/:id', checkPermission('diagnosticos', 'editar'), DiagnosticoController.delete);
router.post('/diagnosticos/validate', checkPermission('diagnosticos', 'editar'), upload.single('file'), DiagnosticoController.validateExcel);
router.post('/diagnosticos/import', checkPermission('diagnosticos', 'editar'), upload.single('file'), DiagnosticoController.importExcel);


// --- ROTAS DE EXAMES ---
router.post('/exames', checkPermission('exames', 'editar'), ExamesController.store);


// --- ROTAS DE INFOS COMORBIDADE ---
router.post('/infos-comorbidade', checkPermission('comorbidades', 'editar'), InfosComorbidadeController.store);


// --- ROTAS DE AVALIAÇÕES (QUESTIONÁRIOS) ---
router.post('/evaluations/templates', checkPermission('avaliacoes', 'editar'), EvaluationBuilderController.store);
router.patch('/evaluations/templates/:id/status', checkPermission('avaliacoes', 'editar'), EvaluationBuilderController.toggleStatus);
router.get('/evaluations/templates', checkPermission('avaliacoes', 'acessar'), EvaluationBuilderController.index);
router.post('/evaluations/responses', checkPermission('avaliacoes', 'editar'), EvaluationResponseController.store);
router.get('/evaluations/responses', checkPermission('avaliacoes', 'acessar'), EvaluationResponseController.index);
// Onde estava /pending/:entrevista_id, altere para:
router.get('/evaluations/templates/pending/:paciente_id', checkPermission('avaliacoes', 'acessar'), EvaluationBuilderController.getPendingForPatient);
router.put('/evaluations/templates/:id', checkPermission('avaliacoes', 'editar'), EvaluationBuilderController.update);

// --- TIMELINE DE AVALIAÇÕES ---
router.get('/avaliacoes', checkPermission('avaliacoes', 'acessar'), EvaluationResponseController.index);


// --- ROTAS DE MÉDICOS ---
router.post('/medicos', checkPermission('medicos', 'editar'), MedicoController.store);
router.get('/medicos', checkPermission('medicos', 'acessar'), MedicoController.index);


// --- ROTAS DE COMORBIDADES (CADASTRO BASE) ---
router.post('/comorbidades', checkPermission('comorbidades', 'editar'), ComorbidadesController.store);
router.get('/comorbidades', checkPermission('comorbidades', 'acessar'), ComorbidadesController.index);


// --- ROTAS DE MEDICAMENTOS ---
router.post('/medicamentos', checkPermission('medicamentos', 'editar'), MedicamentosController.store);
router.get('/medicamentos', checkPermission('medicamentos', 'acessar'), MedicamentosController.index);
router.post('/medicamentos/validate', upload.single('file'), MedicamentosController.validateExcel);
router.post('/medicamentos/import', upload.single('file'), MedicamentosController.importExcel);


// --- ROTAS DE TERMOS ---
router.post('/termos/send', checkPermission('termos', 'editar'), TermoController.sendLink);
router.get('/termos/paciente/:id/status', checkPermission('termos', 'acessar'), TermoController.checkStatus);

router.post('/nps/send', checkPermission('avaliacoes', 'editar'), NpsController.sendNps); 
router.get('/nps', checkPermission('dashboard', 'acessar'), NpsController.index); 
router.get('/nps/paciente/:id/status', NpsController.checkPatientStatus);



// Rotas de monitoramento
router.post('/monitoramento-medicamentos', checkPermission('telemonitoramento', 'editar'), MonitoramentoMedicamentoController.store);
router.put('/monitoramento-medicamentos/:id', checkPermission('telemonitoramento', 'editar'), MonitoramentoMedicamentoController.update);
router.get('/monitoramento-medicamentos/pendentes', checkPermission('telemonitoramento', 'acessar'), MonitoramentoMedicamentoController.index);
router.get('/monitoramento/timeline', MonitoramentoMedicamentoController.timeline)

/* Rotas de ficha ram */
router.post('/reacao-adversa', checkPermission('reacao_adversa', 'editar'), ReacaoAdversaController.store);
router.get('/reacao-adversa', checkPermission('reacao_adversa', 'acessar'), ReacaoAdversaController.index);
router.put('/reacao-adversa/:id', ReacaoAdversaController.update);
router.delete('/reacao-adversa/:id', ReacaoAdversaController.delete);
router.post('/reacao-adversa/validate', checkPermission('reacao_adversa', 'editar'), upload.single('file'), ReacaoAdversaController.validateExcel);
router.post('/reacao-adversa/import', checkPermission('reacao_adversa', 'editar'), upload.single('file'), ReacaoAdversaController.importExcel);


router.get('/dashboard', checkPermission('dashboard', 'acessar'), DashboardController.index);

router.post('/tentativas-contato', TentativaContatoController.store);
router.get('/tentativas-contato', TentativaContatoController.index);



router.get('/audit-logs',checkPermission('audit-logs', 'acessar'), AuditLogController.index);

router.get('/nps/health',checkPermission('check-saude', 'acessar'), NpsHealthController.checkStatus);



router.get('/chat/conversations', checkPermission('chat', 'acessar'), ChatController.listConversations);
router.get('/chat/conversations/:id', checkPermission('chat', 'acessar'), ChatController.getHistory);
router.post('/chat/send', checkPermission('chat', 'editar'), ChatController.sendMessage);
router.post('/chat/reopen', checkPermission('chat', 'editar'), ChatController.reopenWindow);
router.get('/chat/unread', checkPermission('chat', 'acessar'), ChatController.getUnreadCounts);

export default router;