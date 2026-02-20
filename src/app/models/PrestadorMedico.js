

import Sequelize,{ Model } from "sequelize";

class PrestadorMedico extends Model {

    static init(sequelize) {
        super.init({
            nome: Sequelize.STRING,
            cnpj: Sequelize.STRING,
            cep: Sequelize.STRING,
            logradouro: Sequelize.STRING,
            numero: Sequelize.STRING,
            complemento: Sequelize.STRING,
            bairro: Sequelize.STRING,
            cidade: Sequelize.STRING,
            estado: Sequelize.STRING,
            tipo: Sequelize.ENUM('hospital', 'clinica', 'laboratorio'),
        },{
            sequelize,
            tableName: 'prestador_medico',
        })
        return this;
    }

    static associate(models) {
        this.belongsToMany(models.Medico, {
            through: 'medicos_prestadores',
            as: 'medicos_cadastrados',
            foreignKey: 'prestador_medico_id'
        });
    }


  
}

export default PrestadorMedico