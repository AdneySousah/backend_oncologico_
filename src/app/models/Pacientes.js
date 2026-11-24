import Sequelize, { Model } from "sequelize";

class Pacientes extends Model {
    static init(sequelize) {
        super.init({
            nome: Sequelize.STRING,
            sobrenome: Sequelize.STRING,
            celular: Sequelize.STRING,
            telefone: Sequelize.STRING,
            data_nascimento: Sequelize.DATEONLY,
            sexo: Sequelize.ENUM('M', 'F','nao definido'),
            possui_cuidador: Sequelize.BOOLEAN,
            nome_cuidador: Sequelize.STRING,
            contato_cuidador: Sequelize.STRING,
            cep: Sequelize.STRING,
            logradouro: Sequelize.STRING,
            numero: Sequelize.STRING,
            complemento: Sequelize.STRING,
            bairro: Sequelize.STRING,
            cidade: Sequelize.STRING,
            estado: Sequelize.STRING,
            cpf: Sequelize.STRING,
            fez_entrevista: Sequelize.BOOLEAN,
            status_termo: Sequelize.ENUM('Pendente', 'Aceito', 'Recusado', 'Nao Enviado', 'Cancelado'), // mesmos valores do banco
            is_active: Sequelize.BOOLEAN,
            is_new_user: Sequelize.BOOLEAN,
            tratamento_pausado: Sequelize.BOOLEAN,
            motivo_pausa_tratamento_id: Sequelize.INTEGER,
            motivo_pausa_tratamento: Sequelize.TEXT, // observação livre opcional, além do motivo estruturado acima
            data_pausa_tratamento: Sequelize.DATE,
            medicamento_id: Sequelize.INTEGER, 
            external_id: Sequelize.INTEGER,
            data_entrega_medicamento: Sequelize.DATEONLY,
            qtd_caixas: Sequelize.INTEGER,
            matricula: Sequelize.STRING, 
            email: Sequelize.STRING,
            termo_data_aceite: Sequelize.DATE,
            termo_ip: Sequelize.STRING,
            termo_user_agent: Sequelize.STRING,
            termo_versao_id: Sequelize.INTEGER,
            termo_token: Sequelize.STRING, // link público do termo (ver utils/termoLink.js)
        },{
            sequelize,
            tableName: 'pacientes',
        })
        return this;
    }

    // O token do link público do termo não sai nas respostas da API: quem tem a ficha
    // do paciente não deve conseguir responder o termo por ele. O link só é montado no
    // backend (TermoController.sendLink / ChatController.reopenWindow).
    toJSON() {
        const dados = { ...this.get({ plain: true }) };
        delete dados.termo_token;
        return dados;
    }

    static associate(models) {
        this.belongsTo(models.Operadora, { foreignKey: 'operadora_id', as: 'operadoras' });
        this.belongsTo(models.Medicamentos, { foreignKey: 'medicamento_id', as: 'medicamento' }); // Nova relação
        this.hasMany(models.PacientesAnexos, { foreignKey: 'paciente_id', as: 'anexos' });
        this.hasMany(models.PatientEvaluation, { foreignKey: 'paciente_id', as: 'avaliacoes' });
        this.belongsTo(models.MotivoPausaTratamento, { foreignKey: 'motivo_pausa_tratamento_id', as: 'motivoPausaTratamento' });
        this.belongsTo(models.VersaoTermo, { foreignKey: 'termo_versao_id', as: 'versaoTermo' });
    }
}

export default Pacientes;