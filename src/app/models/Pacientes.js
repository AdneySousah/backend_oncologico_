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
            status_termo: Sequelize.ENUM('aceito', 'recusado', 'pendente'),
            is_active: Sequelize.BOOLEAN,
            is_new_user: Sequelize.BOOLEAN,
            medicamento_id: Sequelize.INTEGER, // Adicionado aqui
        },{
            sequelize,
            tableName: 'pacientes',
        })
        return this;
    }

    static associate(models) {
        this.belongsTo(models.Operadora, { foreignKey: 'operadora_id', as: 'operadoras' });
        this.belongsTo(models.Medicamentos, { foreignKey: 'medicamento_id', as: 'medicamento' }); // Nova relação
        this.hasMany(models.PacientesAnexos, { foreignKey: 'paciente_id', as: 'anexos' });
        this.hasMany(models.PatientEvaluation, { foreignKey: 'paciente_id', as: 'avaliacoes' });
    }
}

export default Pacientes;